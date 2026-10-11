import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const workspaceDir = path.resolve(".");
const skillDir =
  process.env.SKILL_DIR ??
  "C:/Users/urosd/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations";
const runtimeModules = process.env.RUNTIME_NODE_MODULES;
const python = process.env.RUNTIME_PYTHON;
if (!runtimeModules || !python)
  throw new Error(
    "Set RUNTIME_NODE_MODULES and RUNTIME_PYTHON from load_workspace_dependencies.",
  );
const { Presentation, PresentationFile, FileBlob } = await import(
  pathToFileURL(
    path.join(runtimeModules, "@oai/artifact-tool/dist/artifact_tool.mjs"),
  ).href
);
const { resolvePresentationFont, finalizePresentation } = await import(
  pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs"))
    .href
);
const buildDir = path.resolve(".runtime/pitch-build");
const outputDir = path.resolve("presentation");
await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
const pitch = JSON.parse(
  await fs.readFile(path.join(outputDir, "pitch.json"), "utf8"),
);
const font = resolvePresentationFont({ fontFamily: "Arial" });
const presentation = Presentation.create({
  slideSize: { width: 1280, height: 720 },
});
const color = {
  ink: "#172335",
  muted: "#526274",
  blue: "#185ABC",
  green: "#137333",
  red: "#B3261E",
};
function text(
  slide,
  value,
  x,
  y,
  w,
  h,
  size = 32,
  bold = false,
  fill = color.ink,
  name = "",
) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name: name || value.slice(0, 45),
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  shape.text = value;
  shape.text.style = {
    typeface: font,
    fontSize: size,
    bold,
    color: fill,
    autoFit: "none",
    insets: { left: 0, top: 0, right: 0, bottom: 0 },
    verticalAlignment: "top",
  };
  return shape;
}
async function image(slide, file, x, y, w, h, alt) {
  return slide.images.add({
    blob: new Uint8Array(
      await fs.readFile(path.join(outputDir, "assets", file)),
    ),
    contentType: "image/png",
    position: { left: x, top: y, width: w, height: h },
    fit: "contain",
    alt,
  });
}
const spoken = (slide) =>
  slide.script ?? slide.chapters.map((chapter) => chapter.say).join(" ");
const wordCount = (value) => value.trim().split(/\s+/).length;
const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
let elapsed = 0;
let script =
  "# GEvents presenter script\n\nOne presenter. English. **6:45 core**, **7:30 expanded target**, eight-minute hard limit. Speak at about 125–135 words per minute, with the timed demo included once. Rehearse aloud: timing depends on your delivery.\n\nOnly the quoted narration is spoken. Cues and source notes are for preparation. Do not read the rubric aloud as a checklist.\n\n";
for (const [index, item] of pitch.slides.entries()) {
  const slide = presentation.slides.add();
  slide.background.fill = "#FFFFFF";
  const start = elapsed;
  elapsed += item.seconds;
  if (!["opening", "walkthrough"].includes(item.id))
    text(slide, item.title, 64, 46, 1152, 86, 47, true);
  const notes = [
    `Slide ${index + 1}. Core ${clock(start)}–${clock(elapsed)}.`,
    item.cue,
    "",
    "SPOKEN SCRIPT",
    item.chapters
      ? item.chapters
          .map((chapter) => `[Video ${chapter.time}] ${chapter.say}`)
          .join("\n\n")
      : item.script,
    ...(item.optional
      ? [
          "",
          `OPTIONAL EXPANSION (+${item.optionalSeconds} seconds)`,
          item.optional,
        ]
      : []),
    ...(item.sources ? ["", "SOURCES AND EVIDENCE", ...item.sources] : []),
  ].join("\n");
  slide.speakerNotes.textFrame.setText(notes);
  script += `## Slide ${index + 1}: ${item.title} (${clock(start)}–${clock(elapsed)})\n\n**Cue:** ${item.cue}\n\n`;
  if (item.chapters)
    script += item.chapters
      .map(
        (chapter) =>
          `**Video ${chapter.time} · ${chapter.step}**\n\n> ${chapter.say}\n`,
      )
      .join("\n");
  else script += `> ${item.script}\n`;
  if (item.optional)
    script += `\n**Optional expansion (+${item.optionalSeconds} seconds):**\n\n> ${item.optional}\n`;
  script += "\n";
  switch (item.id) {
    case "opening":
      await image(slide, "logo.png", 66, 94, 100, 100, "Original GEvents logo");
      text(slide, "GEvents", 192, 100, 900, 110, 90, true);
      text(slide, item.headline, 66, 305, 1150, 210, 57, true);
      text(
        slide,
        "GDG Belgrade hackathon",
        66,
        610,
        1100,
        45,
        25,
        false,
        color.muted,
      );
      break;
    case "problem":
      text(slide, item.leftLabel, 66, 211, 540, 55, 34, true, color.blue);
      text(slide, item.leftText, 66, 302, 550, 230, 38);
      text(slide, item.rightLabel, 702, 211, 510, 55, 34, true, color.green);
      text(slide, item.rightText, 702, 302, 510, 230, 38);
      text(
        slide,
        "First customer: organizations running recurring professional and educational events",
        66,
        618,
        1150,
        54,
        24,
        false,
        color.muted,
      );
      break;
    case "algorithm":
      item.stages.forEach((stage, i) => {
        text(
          slide,
          String(i + 1),
          66 + i * 390,
          213,
          70,
          72,
          58,
          true,
          [color.blue, color.green, color.red][i],
        );
        text(slide, stage.title, 66 + i * 390, 304, 350, 58, 35, true);
        text(
          slide,
          stage.text,
          66 + i * 390,
          393,
          350,
          142,
          29,
          false,
          color.muted,
        );
      });
      text(
        slide,
        "Google EmbeddingGemma compares meaning. Eligibility remains explicit.",
        66,
        612,
        1150,
        52,
        25,
        false,
        color.blue,
      );
      break;
    case "walkthrough":
      slide.background.fill = "#080D1B";
      await image(
        slide,
        "tour-welcome.png",
        64,
        0,
        1152,
        720,
        "GEvents walkthrough video poster",
      );
      break;
    case "evidence":
      text(slide, item.largeNumber, 66, 200, 660, 160, 116, true, color.blue);
      text(slide, item.numberLabel, 66, 385, 680, 56, 33, true);
      text(slide, item.body, 66, 470, 1150, 133, 27, false, color.muted);
      text(slide, item.disclosure, 66, 640, 1150, 44, 24, true, color.red);
      break;
    case "architecture":
      item.layers.forEach((layer, i) => {
        text(
          slide,
          layer.title,
          66,
          191 + i * 130,
          315,
          58,
          31,
          true,
          color.blue,
        );
        text(slide, layer.text, 404, 191 + i * 130, 810, 100, 30);
      });
      text(
        slide,
        "Local model evidence. Cloud deployment and production load remain to verify.",
        66,
        636,
        1150,
        48,
        24,
        false,
        color.muted,
      );
      break;
    case "competition":
      text(slide, item.body, 66, 213, 1150, 300, 40);
      text(slide, item.disclosure, 66, 620, 1150, 46, 25, false, color.muted);
      break;
    case "business":
      text(slide, item.price, 66, 180, 420, 112, 94, true, color.blue);
      text(slide, item.priceLabel, 520, 199, 680, 85, 30);
      text(slide, item.scenario, 66, 340, 1150, 130, 35);
      text(slide, item.costs, 66, 525, 1150, 75, 27, false, color.muted);
      text(slide, item.disclosure, 66, 641, 1150, 40, 24, true, color.red);
      break;
    case "expansion":
      text(slide, item.body, 66, 229, 1150, 290, 40);
      text(
        slide,
        "Next milestone: a real organizer pilot",
        66,
        618,
        1150,
        58,
        31,
        true,
        color.blue,
      );
      break;
    case "close":
      text(slide, item.body, 66, 245, 1150, 220, 59, true);
      text(
        slide,
        "Our next step is to prove the value with organizers",
        66,
        602,
        1150,
        58,
        29,
        false,
        color.blue,
      );
      break;
  }
}
// Backup slides follow the final pitch slide. They are for questions or a failed demonstration.
for (const [file, title, note] of [
  [
    "tour-profile.png",
    "Profile inputs",
    "Backup to slide 4. Existing skills and learning goals are distinct. This screenshot uses a fictional profile.",
  ],
  [
    "tour-reasons.png",
    "Recommendation evidence",
    "Backup to slide 4. Explain the visible reasons and eligibility checks. This screenshot uses structured demo recommendations.",
  ],
  [
    "tour-review.png",
    "Organizer decisions",
    "Backup to slide 4. The organization reviews role-specific applications. No admission actions were performed during recording.",
  ],
]) {
  const slide = presentation.slides.add();
  slide.background.fill = "#FFFFFF";
  text(slide, title, 64, 42, 1152, 76, 47, true);
  await image(slide, file, 190, 135, 900, 562, title);
  slide.speakerNotes.textFrame.setText(
    note +
      "\nFor normal delivery, stop at slide 10. These appendix slides are not additional timed pitch content.",
  );
}

script += `## Timing and fallback delivery\n\nCore narration: **${pitch.slides.reduce((total, item) => total + wordCount(spoken(item)), 0)} words**. Optional narration: **${pitch.slides.reduce((total, item) => total + (item.optional ? wordCount(item.optional) : 0), 0)} words**. Core slide budgets total ${clock(elapsed)}. Speaking speed and route/video startup affect actual timing.\n\n- **6:45 core:** omit every optional paragraph.\n- **7:30 target:** add the three optional paragraphs only if rehearsal fits.\n- **Live:** use Next manually to match the narration, or Play for a prepared 100-second tour after the launch.\n- **Recorded:** on slide 4, play the silent MP4 once and narrate its chapters.\n- **Static:** use appendix slides 11–13 if media fails, then return to slide 5.\n\n**Emergency 35-second demo substitute:**\n\n> The profile describes what a person brings, wants to learn and how they want to join. For you shows suitable events and explains the match. The organizer workspace handles event requirements and applications. People decide whether to join, and organizers control admission. Here we are showing actual application screenshots with fictional profiles. The full working walkthrough is available in our recording.\n\nIf still speaking at 7:30, go straight to the closing. At 7:45, use: **“GEvents matches people and events in both directions. Our next step is to prove the value with organizers. Thank you.”**\n\n## Research replacement when evidence arrives\n\nKeep the current honest research paragraph until findings exist. A replacement structure is: “We interviewed [actual count] organizers and [actual count] people. They identified [actual problem]. We changed [actual feature] and [actual follow-up result].” Those brackets are an editing guide, not spoken text and not claims in the deck.\n\n## Complete rubric coverage\n\n| Criterion | Where it appears | Evidence or gap |\n|---|---|---|\n| Problem clearly defined | Slides 1–2 | Recruitment and discovery mismatch |\n| Relevance to competition | Slides 1–2 | GDG hackathon example; formal theme still needs confirmation |\n| Research involving real users | Slide 5 | Not completed; next pilot stated honestly |\n| Adaptation to research findings | Slide 5 | Real-user feedback still needed; technical corrections are separate |\n| Addressing identified problems | Slides 3–5 | Matching logic and working app; customer outcome validation pending |\n| Expansion beyond local market | Slide 9 | Organizer/community expansion plan |\n| Architecture and Google technologies | Slide 6 | Firebase, Gemma and EmbeddingGemma; deployment status qualified |\n| Components implemented | Slides 4 and 6 | Existing app and pipeline code; live cloud integration not claimed |\n| Implementation challenge and resolution | Slide 5 | Weak matches and mis-extracted restrictions; corrected checks |\n| Actual use rather than mockup | Slide 4 | Real app video/live tour with fictional data disclosed |\n| Scalability in current state | Slide 6 | Bounded pilot; caching/indexes; production load not measured |\n| Target personae and market need | Slide 2 | Recurring organizers buy; people in several roles use |\n| Market and competition research | Slide 7 | Brella and Swapcard official product pages; demand research pending |\n| Sustainable monetization and realistic revenue | Slide 8 | Package/subscription proposal and explicit assumption scenario |\n| Development costs and resources | Slides 1, 6 and 8 | Four-person team; engineering, inference, hosting, support and acquisition; detailed measured budget pending |\n| Users versus buyers | Slides 2 and 8 | People use, organizations pay |\n| Visually consistent presentation | Entire deck | GEvents palette, editable text and real app screenshots |\n| Necessary information without overcrowding | Slides 1–10 | Spoken detail in notes; ten core slides, three backup slides |\n| Complete pitch content | Slides 1–10 | Problem, solution, demo, evidence, technology and business |\n| Engaging pitch | Slides 1, 3 and 4 | Concrete organizer situation, eligibility example and spotlight demo |\n| Complete delivery on time | This script | 6:45 core budget, 7:30 expansion and hard-stop fallback |\n\nMentioning an unfulfilled criterion does not satisfy its evidence requirement. Add real research, willingness-to-pay findings and measured infrastructure costs before claiming those points.\n\n## Sources\n\n- Supplied four-page Grading criteria PDF, reviewed in this conversation.\n- Local technical report: [evaluation](../docs/local-matching-evaluation-2026-10-11.md).\n- Current architecture: [Gemma matching](../docs/gemma-matching.md) and [README](../README.md).\n- [Brella matchmaking](https://www.brella.io/event-matchmaking).\n- [Swapcard matching use cases](https://help.swapcard.com/en/articles/11985775-how-to-set-up-a-hosted-buyer-event).\n- [Swapcard pricing](https://www.swapcard.com/pricing-plans).\n- Team size and pitch limit supplied by the user. Pricing and volume are authored assumptions.\n`;
await fs.writeFile(path.join(outputDir, "PRESENTER-SCRIPT.md"), script);
await fs.writeFile(
  path.join(buildDir, "presentation.json"),
  JSON.stringify(presentation.toProto()),
);
const candidatePath = path.join(buildDir, "candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
if (process.argv.includes("--draft")) {
  for (let i = 0; i < presentation.slides.items.length; i++) {
    const preview = await presentation.export({
      slide: presentation.slides.items[i],
      format: "png",
      scale: 1,
    });
    await fs.writeFile(
      path.join(buildDir, `slide-${i + 1}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }
  console.log(
    JSON.stringify(
      {
        draft: candidatePath,
        slides: presentation.slides.items.length,
        coreSeconds: elapsed,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
let finalCandidate = candidatePath;
if (!process.argv.includes("--without-video")) {
  const result = spawnSync(
    python,
    [
      "scripts/embed-pitch-video.py",
      candidatePath,
      path.join(outputDir, "GEvents-Walkthrough.mp4"),
    ],
    { cwd: workspaceDir, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  finalCandidate = path.join(buildDir, "candidate-media.pptx");
}
let finalPath = path.join(outputDir, "GEvents-Pitch.pptx");
try {
  await fs.access(finalPath);
  finalPath = path.join(outputDir, `GEvents-Pitch-${Date.now()}.pptx`);
} catch {}
await finalizePresentation({
  workspaceDir,
  candidatePath: finalCandidate,
  finalPath,
  pythonExecutable: python,
  integrityValidatorPath: path.join(
    skillDir,
    "container_tools/inspect_presentation_package_integrity.py",
  ),
  layoutValidatorPath: path.join(
    skillDir,
    "container_tools/inspect_presentation_layout_geometry.py",
  ),
  layoutArgs: [
    "--expected-slide-size-emu",
    "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
  ],
  fontPolicy: { basis: "design", families: [font] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(
    buildDir,
    path.basename(finalPath) + ".validation.json",
  ),
});
const finalPresentation = await PresentationFile.importPptx(
  await FileBlob.load(finalPath),
);
for (let i = 0; i < finalPresentation.slides.items.length; i++) {
  const slide = finalPresentation.slides.items[i];
  const preview = await finalPresentation.export({
    slide,
    format: "png",
    scale: 1,
  });
  await fs.writeFile(
    path.join(buildDir, `slide-${i + 1}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}
console.log(
  JSON.stringify(
    {
      deck: finalPath,
      slides: presentation.slides.items.length,
      coreSeconds: elapsed,
      spokenWords: pitch.slides.reduce(
        (total, item) => total + wordCount(spoken(item)),
        0,
      ),
    },
    null,
    2,
  ),
);
