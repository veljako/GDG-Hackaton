# GEvents presenter script

One presenter. English. **6:45 core**, **7:30 expanded target**, eight-minute hard limit. Speak at about 125–135 words per minute, with the timed demo included once. Rehearse aloud: timing depends on your delivery.

Only the quoted narration is spoken. Cues and source notes are for preparation. Do not read the rubric aloud as a checklist.

## Slide 1: GEvents (0:00–0:25)

**Cue:** Stand facing the judges. Start the timer on the first spoken word.

> Imagine organizing a hackathon. You have a venue and a challenge, but you still need people who want to build, mentors who can help, and speakers who fit the topic. Meanwhile, those people are searching for the right opportunity. We are a team of four, and we built GEvents to connect both sides.

## Slide 2: Finding the right fit takes work (0:25–1:05)

**Cue:** Point once to each side. Keep the focus on the buyer's problem.

> Our problem is a mismatch between opportunities and people. An organizer needs relevant expertise and people who actually want to contribute. A person needs an event that suits their interests, availability and goals. Browsing a long list does not answer either question. Our first target is organizations running recurring professional and educational events, including communities like GDG. Participants, speakers, mentors and judges use GEvents. The organization is our proposed paying customer because it benefits from less recruitment work and more suitable participation.

## Slide 3: The matchmaking algorithm (1:05–2:05)

**Cue:** Slow down on eligibility versus relevance. This is the central technical explanation.

> The matchmaking algorithm is the core of GEvents. It connects a person's profile with an event's purpose and requirements, in both discovery and recruitment. First, we check eligibility, such as required skills and registration dates. Then we rank relevance using interests, experience, goals and roles. The semantic pipeline uses Google EmbeddingGemma to compare meaning beyond identical words. Crucially, skills someone has and skills they want to learn stay separate. A beginner can fit a learning workshop without qualifying to mentor it. We explain recommendations, and people and organizers make the final decision. If nothing is suitable, the right answer is no match. A similarity score never guarantees admission.

**Optional expansion (+15 seconds):**

> A speaker needs relevant expertise and willingness to speak. A participant looking to learn has a different goal. We will validate both with organizers.

## Slide 4: GEvents in use (2:05–3:50)

**Cue:** Play the embedded video once, or switch to the prepared live tour. Narrate over the silent recording. Do not play video and then repeat the live demo.

**Video 00:00–00:04 · launch**

> Here is the working application.

**Video 00:04–00:12 · welcome**

> The home page brings event discovery and your team into one place. The tour highlights the actual interface.

**Video 00:12–00:22 · profile**

> Matching starts with the profile. Existing skills describe what you can contribute. Learning interests describe what you want to gain.

**Video 00:22–00:30 · roles**

> You also choose how to join: as a participant, mentor, speaker or judge. Participation means different things to different people.

**Video 00:30–00:42 · recommendations**

> For you narrows the list to suitable opportunities. This recording uses structured demo recommendations. We tested the Google semantic models separately, using real local inference.

**Video 00:42–00:52 · reasons**

> Each recommendation gives concrete reasons. The person can inspect the fit, rather than trusting an unexplained number. Requirements still apply.

**Video 00:52–01:00 · search**

> People can also browse all events and use filters. They remain free to explore outside their personal recommendations.

**Video 01:00–01:10 · team**

> Team spaces support collaboration around an event. The semantic candidate integration can search for missing capabilities when its service is connected.

**Video 01:10–01:22 · organizer**

> Now the organization's view. Organizers define the opportunity and manage it. Configured publication invitations reach suitable people who opted in. This tour does not send anything.

**Video 01:22–01:34 · review**

> Applications identify the role someone wants. Organizers control admission and capacity. An invitation, an accepted invitation and event admission represent different decisions.

**Video 01:34–01:45 · activity**

> My activity brings those decisions together. That is the complete product loop: discover a relevant opportunity, choose a role, and track the next step.

## Slide 5: What we tested and learned (3:50–4:30)

**Cue:** Say 'diagnostic checks', never '100 percent accurate'. Replace the research paragraph only after real evidence is supplied.

> During implementation, we found a real problem: semantic similarity still returned weak recommendations, and extraction sometimes invented restrictions. We added source-grounded checks and a relevance gate. Our local evaluation then passed fifty diagnostic checks across seven fictional profiles and two synthetic events. That is technical evidence, not population-wide accuracy. We have not completed real-user interviews yet. Our first organizer pilot will measure useful shortlists, time saved and accepted invitations, then use that feedback to improve matching.

**Optional expansion (+10 seconds):**

> Wanting to learn React did not satisfy an event's requirement for acquired React skills. Eligibility remained separate from relevance.

## Slide 6: Google technology and the pilot architecture (4:30–5:05)

**Cue:** Distinguish the architecture from deployment status. Do not claim tested scale.

> The React application uses an authenticated Node API. Firebase handles identity and canonical data, with private storage for CVs. Gemma supports reviewed extraction, and EmbeddingGemma supplies retrieval vectors. The API enforces permissions and eligibility after matching. These components exist in code, with local model evidence. Cloud deployment remains to verify. This is a bounded pilot. Cached embeddings and indexed retrieval support growth, but production latency, concurrent load and costs still need measurement.

## Slide 7: Our position in an existing market (5:05–5:30)

**Cue:** Acknowledge competition directly. Present the distinction as the focus we will validate.

> We researched existing products. Brella and Swapcard already offer event matchmaking, so AI alone is not our differentiation. Our proposed focus is finding people for opportunities before the event, and helping those people discover suitable events across a community. Reusable profiles can make each following event easier to organize.

## Slide 8: Organizations pay for better recruitment (5:30–6:10)

**Cue:** Point to 'hypotheses'. Do not imply payments or subscriptions are implemented.

> Our proposed model keeps access free for people and charges organizations. We would start with a predictable event package, then offer subscriptions for recurring organizers. For illustration, a one-hundred-and-forty-nine-euro package for up to two hundred people would generate seventeen thousand eight hundred and eighty euros annually if twenty organizations ran six events each. These are assumptions, not customers or a forecast. Costs include model inference, hosting, support, acquisition and engineering. We will validate willingness to pay and contribution margin before fixing the price.

**Optional expansion (+20 seconds):**

> We also considered charging per confirmed person. It aligns with an outcome, but creates questions about no-shows and people the organizer recruited independently. A capped event package is easier to budget. A success fee could later apply to clearly attributed new introductions.

## Slide 9: A focused start, then wider communities (6:10–6:30)

**Cue:** Keep expansion concrete. Avoid unsupported market-size numbers.

> We start with recurring professional and educational communities, where the same organization recruits repeatedly. Beyond Belgrade, expansion means onboarding trusted organizers and relevant people in each market. Our next milestone is a real pilot that validates matching quality and organizational value.

## Slide 10: The right fit creates the next opportunity (6:30–6:45)

**Cue:** Stop at 6:45 in the core run, or about 7:30 with the optional lines. Stay on this slide for questions.

> GEvents connects what an event needs with what a person can contribute and wants to gain. Our next step is to prove that value with organizers. Thank you.

## Timing and fallback delivery

Core narration: **811 words**. Optional narration: **85 words**. Core slide budgets total 6:45. Speaking speed and route/video startup affect actual timing.

- **6:45 core:** omit every optional paragraph.
- **7:30 target:** add the three optional paragraphs only if rehearsal fits.
- **Live:** use Next manually to match the narration, or Play for a prepared 100-second tour after the launch.
- **Recorded:** on slide 4, play the silent MP4 once and narrate its chapters.
- **Static:** use appendix slides 11–13 if media fails, then return to slide 5.

**Emergency 35-second demo substitute:**

> The profile describes what a person brings, wants to learn and how they want to join. For you shows suitable events and explains the match. The organizer workspace handles event requirements and applications. People decide whether to join, and organizers control admission. Here we are showing actual application screenshots with fictional profiles. The full working walkthrough is available in our recording.

If still speaking at 7:30, go straight to the closing. At 7:45, use: **“GEvents matches people and events in both directions. Our next step is to prove the value with organizers. Thank you.”**

## Research replacement when evidence arrives

Keep the current honest research paragraph until findings exist. A replacement structure is: “We interviewed [actual count] organizers and [actual count] people. They identified [actual problem]. We changed [actual feature] and [actual follow-up result].” Those brackets are an editing guide, not spoken text and not claims in the deck.

## Complete rubric coverage

| Criterion | Where it appears | Evidence or gap |
|---|---|---|
| Problem clearly defined | Slides 1–2 | Recruitment and discovery mismatch |
| Relevance to competition | Slides 1–2 | GDG hackathon example; formal theme still needs confirmation |
| Research involving real users | Slide 5 | Not completed; next pilot stated honestly |
| Adaptation to research findings | Slide 5 | Real-user feedback still needed; technical corrections are separate |
| Addressing identified problems | Slides 3–5 | Matching logic and working app; customer outcome validation pending |
| Expansion beyond local market | Slide 9 | Organizer/community expansion plan |
| Architecture and Google technologies | Slide 6 | Firebase, Gemma and EmbeddingGemma; deployment status qualified |
| Components implemented | Slides 4 and 6 | Existing app and pipeline code; live cloud integration not claimed |
| Implementation challenge and resolution | Slide 5 | Weak matches and mis-extracted restrictions; corrected checks |
| Actual use rather than mockup | Slide 4 | Real app video/live tour with fictional data disclosed |
| Scalability in current state | Slide 6 | Bounded pilot; caching/indexes; production load not measured |
| Target personae and market need | Slide 2 | Recurring organizers buy; people in several roles use |
| Market and competition research | Slide 7 | Brella and Swapcard official product pages; demand research pending |
| Sustainable monetization and realistic revenue | Slide 8 | Package/subscription proposal and explicit assumption scenario |
| Development costs and resources | Slides 1, 6 and 8 | Four-person team; engineering, inference, hosting, support and acquisition; detailed measured budget pending |
| Users versus buyers | Slides 2 and 8 | People use, organizations pay |
| Visually consistent presentation | Entire deck | GEvents palette, editable text and real app screenshots |
| Necessary information without overcrowding | Slides 1–10 | Spoken detail in notes; ten core slides, three backup slides |
| Complete pitch content | Slides 1–10 | Problem, solution, demo, evidence, technology and business |
| Engaging pitch | Slides 1, 3 and 4 | Concrete organizer situation, eligibility example and spotlight demo |
| Complete delivery on time | This script | 6:45 core budget, 7:30 expansion and hard-stop fallback |

Mentioning an unfulfilled criterion does not satisfy its evidence requirement. Add real research, willingness-to-pay findings and measured infrastructure costs before claiming those points.

## Sources

- Supplied four-page Grading criteria PDF, reviewed in this conversation.
- Local technical report: [evaluation](../docs/local-matching-evaluation-2026-10-11.md).
- Current architecture: [Gemma matching](../docs/gemma-matching.md) and [README](../README.md).
- [Brella matchmaking](https://www.brella.io/event-matchmaking).
- [Swapcard matching use cases](https://help.swapcard.com/en/articles/11985775-how-to-set-up-a-hosted-buyer-event).
- [Swapcard pricing](https://www.swapcard.com/pricing-plans).
- Team size and pitch limit supplied by the user. Pricing and volume are authored assumptions.
