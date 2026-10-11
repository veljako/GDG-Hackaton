import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";

// Transcode the actual browser recording with Chromium's native H.264 encoder.
// No screenshots, fabricated actions or synthetic matching results enter this file.
const source = path.resolve(".runtime/pitch-tour/GEvents-Walkthrough.webm");
const final = path.resolve("presentation/GEvents-Walkthrough.mp4");
const server = http.createServer(async (request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><title>GEvents video conversion</title>');
    return;
  }
  if (!["/source.webm", "/final.mp4"].includes(request.url)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const file = request.url === "/source.webm" ? source : final;
  try {
    const { size } = await fs.stat(file);
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end =
      range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    response.writeHead(range ? 206 : 200, {
      "Content-Type": file.endsWith("mp4") ? "video/mp4" : "video/webm",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    createReadStream(file, { start, end }).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GEVENTS_CHROMIUM ??
    "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
});
try {
  const page = await browser.newPage();
  await page.goto(address + "/");
  console.log("Encoding the verified browser recording to H.264 MP4...");
  const result = await page.evaluate(async (url) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    document.body.append(video);
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error("Cannot load source video"));
    });
    const mime = "video/mp4;codecs=avc1.42E01E";
    if (!MediaRecorder.isTypeSupported(mime))
      throw new Error("This Chromium build cannot encode H.264 MP4");
    const recorder = new MediaRecorder(video.captureStream(), {
      mimeType: mime,
      videoBitsPerSecond: 3500000,
    });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = (event) =>
        reject(new Error(event.error?.message ?? "Video conversion failed"));
      recorder.onstop = resolve;
    });
    recorder.start(1000);
    await video.play();
    await new Promise((resolve) => {
      video.onended = resolve;
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mime });
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(blob);
    });
    return {
      base64,
      sourceDuration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      mime,
      bytes: blob.size,
    };
  }, address + "/source.webm");
  await fs.writeFile(final, Buffer.from(result.base64, "base64"));
  const decoded = await page.evaluate(async (url) => {
    const video = document.createElement("video");
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  }, address + "/final.mp4");
  if (
    !Number.isFinite(decoded.duration) ||
    Math.abs(decoded.duration - result.sourceDuration) > 2
  )
    throw new Error("Converted video duration differs from source");
  const metadata = {
    ...decoded,
    sourceDuration: result.sourceDuration,
    mime: result.mime,
    bytes: result.bytes,
  };
  await fs.mkdir(".runtime/pitch-tour", { recursive: true });
  await fs.writeFile(
    ".runtime/pitch-tour/video-metadata.json",
    JSON.stringify(metadata, null, 2),
  );
  console.log(JSON.stringify(metadata, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
