import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { resolve } from "node:path";

// Mutates fictional users. Run against the dedicated verification server only.
const base = process.env.GEVENTS_USER_DB_URL ?? "http://127.0.0.1:5197";
if (!/^http:\/\/(127\.0\.0\.1|localhost):5197$/.test(base))
  throw Error("Use the dedicated local user-database test server on 5197.");
const cached =
  "C:/Users/urosd/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(cached) ? { executablePath: cached } : {}),
});
const directory = resolve("artifacts/user-db");
fs.mkdirSync(directory, { recursive: true });
const errors = [];
const checks = [];
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
);
async function snapshot(page) {
  return page.evaluate(
    async () =>
      (
        await (
          await fetch("/api/state", {
            headers: {
              Authorization:
                "Bearer " + sessionStorage.getItem("gevents-api-session"),
            },
          })
        ).json()
      ).state,
  );
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#/profile");
    await page.getByRole("heading", { name: "Your profile." }).waitFor();
    await page
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    const form = page.locator("#profile-edit-form");
    await form.locator('[name="first_name"]').fill("Ana Marija");
    await form.locator('[name="last_name"]').fill("Petrović");
    await form.locator('[name="phone"]').fill("+381601234567");
    await form.locator('[name="birth_year"]').fill("1998");
    await form.locator('[name="status"]').selectOption("Freelancer");
    await form.locator('[name="experience_level"]').selectOption("Mid");
    await form.locator('[name="languages"]').fill("Serbian, English");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    let state = await snapshot(page);
    let me = state.people.find((p) => p.id === "luka");
    expect(me).toMatchObject({
      first_name: "Ana Marija",
      last_name: "Petrović",
      name: "Ana Marija Petrović",
      phone: "+381601234567",
      birth_year: 1998,
      status: "Freelancer",
      experience_level: "Mid",
      languages: ["Serbian", "English"],
    });
    const savedAt = me.updated_at;
    await page.reload();
    await page.getByRole("heading", { name: "Your profile." }).waitFor();
    expect(
      (await snapshot(page)).people.find((p) => p.id === "luka").updated_at,
    ).toBe(savedAt);
    await page
      .getByLabel("Attach CV file", { exact: true })
      .setInputFiles({
        name: "ana-cv.pdf",
        mimeType: "application/pdf",
        buffer: pdf,
      });
    await expect(
      page.getByRole("button", { name: "Download your CV", exact: true }),
    ).toBeVisible();
    me = (await snapshot(page)).people.find((p) => p.id === "luka");
    expect(me.cv_document).toMatchObject({
      filename: "ana-cv.pdf",
      size_bytes: pdf.length,
      extraction_status: "not_started",
    });
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download your CV", exact: true })
      .click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe("ana-cv.pdf");
    expect(fs.readFileSync(await file.path())).toEqual(pdf);
    await page.screenshot({
      path: resolve(directory, `profile-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Remove CV attachment", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Download your CV", exact: true }),
    ).toHaveCount(0);
    expect(
      (await snapshot(page)).people.find((p) => p.id === "luka").cv_document,
    ).toBeNull();
    checks.push(
      `${width}px: explicit names/contact saved across reload; private CV uploaded/downloaded/removed; no overflow`,
    );
    await context.close();
  }
  expect(errors).toEqual([]);
  fs.writeFileSync(
    resolve(directory, "verification.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
