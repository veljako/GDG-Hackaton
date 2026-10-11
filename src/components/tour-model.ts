export type TourRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type TourStep = {
  id: string;
  route: string;
  target: string;
  title: string;
  body: string;
  seconds: number;
  mode: "attendee" | "organizer";
  revealDetails?: boolean;
};

export function buildTour(canOrganize: boolean, teamId?: string): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome",
      route: "/",
      target: '[data-tour="welcome"]',
      title: "Find your people.\nFind your thing.",
      body: "Big ideas start with a good match. Let’s find events that fit what you bring, what you’re curious about and how you want to join.",
      seconds: 8,
      mode: "attendee",
    },
    {
      id: "profile",
      route: "/profile",
      target: '[data-tour="profile-fit"]',
      title: "Your skills.\nYour next adventure.",
      body: "Show what you know and what you want to learn. They’re different signals—and both help you find your next opportunity.",
      seconds: 10,
      mode: "attendee",
    },
    {
      id: "roles",
      route: "/profile",
      target: '[data-tour="profile-roles"]',
      title: "Builder? Mentor?\nTake your pick.",
      body: "Participant, mentor, speaker or judge: there’s more than one way to be part of an event. Your preferred role helps shape the match.",
      seconds: 8,
      mode: "attendee",
    },
    {
      id: "recommendations",
      route: "/events?view=for-you",
      target:
        '[data-tour="event-results"] .event-card:first-child, .empty-state',
      title: "Less scrolling.\nMore ‘that’s me.’",
      body: "For you connects your skills and goals with relevant events. Nothing suitable yet? We’ll say so. A good match is worth waiting for.",
      seconds: 12,
      mode: "attendee",
    },
    {
      id: "reasons",
      route: "/events?view=for-you",
      target: ".match-reasons, .empty-state",
      title: "Why this one?\nHere’s the fit.",
      body: "Open the reasons behind a recommendation. See the connection for yourself; requirements, places and admission still matter.",
      seconds: 10,
      mode: "attendee",
      revealDetails: true,
    },
    {
      id: "search",
      route: "/events",
      target: '[data-tour="event-search"]',
      title: "Follow your curiosity.",
      body: "Prefer to explore? Browse all events, then filter by topic, place, date or format. Your next great idea might be a little unexpected.",
      seconds: 8,
      mode: "attendee",
    },
    {
      id: "team",
      route: teamId ? `/teams/${encodeURIComponent(teamId)}` : "/teams",
      target: teamId ? ".team-space" : ".teams-grid, .empty-state",
      title: "Good ideas.\nA good crew.",
      body: "Bring your team together around an event. When the semantic matching service is connected, it can help find capabilities your crew is missing.",
      seconds: 10,
      mode: "attendee",
    },
  ];
  if (canOrganize)
    steps.push(
      {
        id: "organizer",
        route: "/organizer",
        target: '[data-tour="organizer-event"]',
        title: "Build the event.\nFind the people.",
        body: "Set the goals, roles and requirements. Configured publication invitations can then reach suitable people who opted in.",
        seconds: 12,
        mode: "organizer",
      },
      {
        id: "review",
        route: "/organizer",
        target: '[data-tour="organizer-review"], .organizer-summary',
        title: "You make the call.",
        body: "A match opens a door. People choose whether to join, and organizers review applications and decide who gets a place.",
        seconds: 12,
        mode: "organizer",
      },
    );
  steps.push({
    id: "activity",
    route: "/activity",
    target: '[data-tour="activity"], #main-content',
    title: "Your next steps.\nAll together.",
    body: "Applications, invitations and decisions live in My activity. That’s the tour—now go find your next opportunity.",
    seconds: 10,
    mode: "attendee",
  });
  return steps;
}

export function spotlightRect(
  rect: TourRect,
  width: number,
  height: number,
): TourRect {
  const left = Math.max(8, Math.min(width - 16, rect.left - 8));
  const top = Math.max(8, Math.min(height - 16, rect.top - 8));
  const right = Math.max(
    left + 1,
    Math.min(width - 8, rect.left + rect.width + 8),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(height - 8, rect.top + rect.height + 8),
  );
  return { left, top, width: right - left, height: bottom - top };
}

export function captionPosition(
  rect: TourRect,
  width: number,
  height: number,
  cardWidth: number,
  cardHeight: number,
) {
  const gap = 20;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  let left = width - cardWidth - 24;
  let top = height - cardHeight - 24;
  if (width >= 720) {
    if (rect.left + rect.width + gap + cardWidth <= width - 12) {
      left = rect.left + rect.width + gap;
      top = rect.top;
    } else if (rect.left - gap - cardWidth >= 12) {
      left = rect.left - gap - cardWidth;
      top = rect.top;
    } else if (rect.top + rect.height + gap + cardHeight <= height - 12) {
      top = rect.top + rect.height + gap;
    } else if (rect.top - gap - cardHeight >= 12) {
      top = rect.top - gap - cardHeight;
    }
  }
  return {
    left: clamp(left, 12, width - cardWidth - 12),
    top: clamp(top, 12, height - cardHeight - 12),
  };
}
