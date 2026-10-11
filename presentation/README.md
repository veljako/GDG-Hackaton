# GEvents pitch package

One presenter, eight-minute limit. The core slide budget is **6:45**. Optional lines on slides 3, 5 and 8 add **45 seconds**, for a **7:30** version and a **30-second safety margin**. These are rehearsal targets, not a guarantee of speaking speed. Rehearse aloud with the actual media and a timer.

## Files

- `GEvents-Pitch.pptx`: editable slides, embedded walkthrough, complete narration in speaker notes, and three appendix slides for questions.
- `PRESENTER-SCRIPT.md`: full script, timestamps, optional expansion and rubric/evidence mapping.
- `GEvents-Walkthrough.mp4`: silent recording of the actual app, including its brand opening and spotlight tutorial. The presenter supplies narration.
- `pitch.json`: shared source for slide copy, spoken text and timing.
- `assets/`: captured fictional app screenshots. These show real product behavior, not drawn mockups.

## Choose one demonstration

**Recommended: PowerPoint with the embedded video.** On slide 4, click the video poster once and narrate using the chapter cues. The video is silent. Test playback on the presentation computer before the event. Keep the standalone MP4 in the same folder as a fallback.

**Live app.** Open the prepared app at `/#/?tour=1`, after signing in where required. Existing launch animation runs first. Click Play once. The complete fictional-demo tour takes about 105 seconds including its opening and route transitions. For manual control, use Next/Back or the arrow keys. Pause waits indefinitely, and Escape exits. Only accounts with organizer permission see organizer steps. The stage rehearsal assumes the complete ten-step fictional demo.

**Video only.** The MP4 demonstrates the product but is not the entire pitch. Give the same spoken opening, algorithm explanation, evidence, architecture and business material around it. A full video pitch would need a separate recording of the presenter or voiceover, which is not claimed here.

**No video or network.** Stay on slide 4's poster, then open the three appendix screenshots in the deck to explain profile input, recommendation reasons and organizer review. Use the same demo narration at a faster conversational pace or omit the optional lines. Return to slide 5 after this explanation. Do not pretend screenshots are a live demo.

## Roles for the four teammates

Only the presenter speaks. Before going on stage, one teammate prepares the deck/video, one confirms the demo session and one watches timing. If competition rules prohibit assistance during the presentation, the presenter uses the recorded video and controls all slides. No live teammate actions are needed for the recording.

## Rehearsal cues

- At **2:05**, begin the demonstration.
- At **3:50**, the demonstration must end.
- At **5:05**, finish architecture and move to competition.
- At **6:10**, finish the core business section.
- At **6:45**, the core pitch ends. The extended version shifts later cues by the optional seconds already used.
- If behind, omit all remaining optional paragraphs. If still behind, replace the demo with the 35-second fallback in the script.
- At **7:30**, begin the closing immediately. At **7:45**, say the final sentence and stop.

## Evidence boundaries

The user has not supplied real-user interviews yet. The script says so and provides a replacement paragraph template outside the spoken script. Pricing and the revenue scenario are illustrative, not validated demand. The 50 checks are technical diagnostics on synthetic records, not 100% matching accuracy. This recording uses structured demo recommendations; actual local Gemma/EmbeddingGemma inference is documented separately. The deck does not claim live Google Cloud deployment or proven production scale.

The tour changes navigation and current-session view mode only. It restores the original route and view on exit. It does not create profiles, publish events, send invitations or change admissions. The recorded demo has a dedicated data file.

## Running and rebuilding

The fictional demo's home page opens the tutorial after the launch animation. Desktop also has a labelled **Take a tour** button in the header; mobile uses its presentation icon. Deep links stay available for direct exploration, and closing the tutorial does not reopen it during the same visit. Real accounts use the button or the explicit `/#/?tour=1` launch link. For an isolated demo:

```powershell
$env:GEVENTS_API_PORT='5201'
$env:GEVENTS_BACKEND_MODE='demo'
$env:GEVENTS_DATA_FILE='.runtime/pitch-tour/state.json'
node --import tsx server/index.ts
```

Open `http://127.0.0.1:5201/#/?tour=1` after `npm.cmd run build`. This is a local link, not a public phone preview. To verify/record: `node scripts/verify-guided-tour.mjs --record`. To convert the recording: `node scripts/convert-tour-video.mjs`. To generate the script/deck: use the bundled Artifact Tool runtime with `node scripts/build-pitch.mjs` after setting its documented runtime environment variables. The builder creates a new validated deck rather than overwriting an existing final file.

Recording needs the FFmpeg build matching the installed Playwright version. Install it into the task cache before recording:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH=(Join-Path $PWD '.runtime/pitch-tour/browsers')
npx.cmd playwright install ffmpeg
```

Set `GEVENTS_CHROMIUM` to your Chromium executable if the default local path differs. The deck builder requires `RUNTIME_NODE_MODULES`, `RUNTIME_PYTHON` and, if moved, `SKILL_DIR` pointing to the bundled presentation skill. These paths are local tooling configuration, not app settings.

Run `node scripts/verify-tour-entry.mjs` against the isolated local demo to check desktop/mobile home entry, tour links with the query on either side of the hash, manual reopening and deep-link restoration.

Sources for competitive claims appear in relevant slide notes. Full criterion coverage and remaining evidence gaps are in the presenter script.
