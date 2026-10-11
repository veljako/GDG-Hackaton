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
      title: "The right people. The right events.",
      body: "Find opportunities that fit what you know, what you want to learn and how you want to contribute.",
      seconds: 8,
      mode: "attendee",
    },
    {
      id: "profile",
      route: "/profile",
      target: '[data-tour="profile-fit"]',
      title: "Matching starts with you",
      body: "Your profile separates the skills you bring from the skills you want to learn. Beginners can find opportunities without claiming expertise they do not have.",
      seconds: 10,
      mode: "attendee",
    },
    {
      id: "roles",
      route: "/profile",
      target: '[data-tour="profile-roles"]',
      title: "Choose how you contribute",
      body: "Join as a participant, mentor, speaker or judge. The role you want matters alongside your interests and experience.",
      seconds: 8,
      mode: "attendee",
    },
    {
      id: "recommendations",
      route: "/events?view=for-you",
      target:
        '[data-tour="event-results"] .event-card:first-child, .empty-state',
      title: "Events selected for your profile",
      body: "Personal recommendations connect your goals and skills with the event. If there is no suitable event, GEvents says so rather than filling the list with weak matches.",
      seconds: 12,
      mode: "attendee",
    },
    {
      id: "reasons",
      route: "/events?view=for-you",
      target: ".match-reasons, .empty-state",
      title: "Understand the match",
      body: "Matching reasons show the evidence behind a recommendation. Relevance does not replace requirements, available places or the organizer’s admission decision.",
      seconds: 10,
      mode: "attendee",
      revealDetails: true,
    },
    {
      id: "search",
      route: "/events",
      target: '[data-tour="event-search"]',
      title: "Explore on your terms",
      body: "Browse all events and narrow the search by topic, location, dates or format. Personal recommendations and open discovery work together.",
      seconds: 8,
      mode: "attendee",
    },
    {
      id: "team",
      route: teamId ? `/teams/${encodeURIComponent(teamId)}` : "/teams",
      target: teamId ? ".team-space" : ".teams-grid, .empty-state",
      title: "Bring complementary people together",
      body: "Team spaces connect people around a shared event. Semantic candidate matching can look for missing capabilities when the matching service is connected.",
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
        title: "Organizations define the opportunity",
        body: "Organizers set event goals, roles and requirements. Configured automatic invitations reach suitable, opted-in people when an event is published.",
        seconds: 12,
        mode: "organizer",
      },
      {
        id: "review",
        route: "/organizer",
        target: '[data-tour="organizer-review"], .organizer-summary',
        title: "People stay in control",
        body: "Organizations review applications and event roles. A match suggests an opportunity; people choose whether to join, and organizers decide admission.",
        seconds: 12,
        mode: "organizer",
      },
    );
  steps.push({
    id: "activity",
    route: "/activity",
    target: '[data-tour="activity"], #main-content',
    title: "A match becomes a real next step",
    body: "Applications, invitations and decisions live in My activity. Explore the app, update your profile or replay this tour whenever you need it.",
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
