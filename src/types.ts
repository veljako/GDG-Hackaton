export type Color = "blue" | "red" | "yellow" | "green";
export type Role = "Participant" | "Mentor" | "Speaker" | "Judge";
export type Admission = "pending" | "accepted" | "rejected";
export type EventKind = "hackathon" | "conference" | "meetup" | "festival";
export type Goal =
  "Learning" | "Networking" | "Building" | "Career" | "Research";
export type Level = "Beginner" | "Intermediate" | "Advanced";
export type EventFormat = "In person" | "Hybrid" | "Online";
export type Preferences = {
  goals: Goal[];
  kinds: EventKind[];
  formats: EventFormat[];
  location: string;
  level?: Level;
  notify: boolean;
};
export type Person = {
  onboarding?: {
    version: 1;
    status: "required" | "completed";
    completed_at: string | null;
    matching_sync?: "pending" | "queued";
  };
  first_name?: string;
  last_name?: string;
  email?: string | null;
  email_verified?: boolean;
  phone?: string;
  education?: Education[];
  work_experience?: WorkExperience[];
  languages?: string[];
  cv_document?: CvDocument | null;
  created_at?: string | null;
  updated_at?: string | null;
  status?: "Student" | "Employed" | "Freelancer" | null;
  birth_year?: number | null;
  experience_level?: "Junior" | "Mid" | "Senior" | null;
  id: string;
  name: string;
  title: string;
  city: string;
  school: string;
  bio: string;
  skills: string[];
  interests: string[];
  roles: Role[];
  experience: string;
  color: Color;
  avatar: string;
  lookingForTeam: boolean;
  linkedin: string;
  kaggle: string;
  cv?: string;
  preferences?: Preferences;
};
export type Education = {
  institution: string;
  degree: string;
  field: string;
  start_date: string | null;
  end_date: string | null;
  description: string;
};
export type WorkExperience = {
  company: string;
  position: string;
  location: string;
  start_date: string | null;
  end_date: string | null;
  description: string;
};
export type CvDocument = {
  storage_path: string;
  filename: string;
  content_type: "application/pdf";
  size_bytes: number;
  uploaded_at: string;
  extraction_status: "not_started" | "processing" | "completed" | "failed";
  extracted_at: string | null;
};
export type GEventsEvent = {
  kind?: EventKind;
  registration?: "review" | "automatic";
  audience?: {
    skills: string[];
    goals: Goal[];
    roles: Role[];
    levels: Level[];
  };
  publishedAt?: string;
  id: string;
  title: string;
  organizer: string;
  date: string;
  endDate: string;
  deadline: string;
  location: string;
  venue: string;
  description: string;
  theme: string;
  tags: string[];
  color: Color;
  format: "In person" | "Hybrid" | "Online";
  capacity: number;
  minTeamSize: number;
  maxTeamSize: number;
  status: "open" | "past" | "draft";
  schedule: { time: string; title: string; description: string }[];
};
/** Kept for compatibility with the existing hackathon components and saved data. */
export type Hackathon = GEventsEvent;
export type Recommendation = {
  eventId: string;
  score: number | null;
  evidence: number;
  reasons: string[];
};
export type Team = {
  id: string;
  eventId: string;
  name: string;
  description: string;
  skills: string[];
  memberIds: string[];
  captainId: string;
  archived: boolean;
};
export type Application = {
  id: string;
  eventId: string;
  personId: string;
  teamId?: string;
  status: Admission;
  role: Role;
  motivation: string;
  submittedAt: string;
};
export type Invitation = {
  id: string;
  teamId: string;
  personId: string;
  fromId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
};
export type Notice = {
  eventId?: string;
  id: string;
  personId: string;
  title: string;
  body: string;
  read: boolean;
  href: string;
};
export type DemoState = {
  recommendations?: Recommendation[];
  version: 1;
  people: Person[];
  events: Hackathon[];
  teams: Team[];
  applications: Application[];
  invitations: Invitation[];
  connections: string[];
  notifications: Notice[];
  currentPersonId: string;
  mode: "attendee" | "organizer";
};
export type Action =
  | { type: "SET_PERSON"; personId: string }
  | { type: "SET_MODE"; mode: "attendee" | "organizer" }
  | { type: "CREATE_EVENT"; event: Omit<Hackathon, "id"> }
  | { type: "UPDATE_EVENT"; eventId: string; changes: Partial<Hackathon> }
  | {
      type: "SUBMIT_APPLICATION";
      eventId: string;
      personId: string;
      teamId?: string;
      role: Role;
      motivation: string;
    }
  | { type: "WITHDRAW_APPLICATION"; applicationId: string }
  | {
      type: "REVIEW_APPLICATION";
      applicationId: string;
      status: "accepted" | "rejected";
    }
  | {
      type: "CREATE_TEAM";
      eventId: string;
      name: string;
      description: string;
      skills: string[];
      personId: string;
      role?: Role;
      motivation?: string;
    }
  | {
      type: "REUSE_TEAM";
      teamId: string;
      eventId: string;
      personId: string;
      role?: Role;
      motivation?: string;
    }
  | { type: "INVITE_PERSON"; teamId: string; personId: string; fromId: string }
  | {
      type: "RESPOND_INVITATION";
      invitationId: string;
      response: "accepted" | "declined";
    }
  | { type: "CANCEL_INVITATION"; invitationId: string; actorId: string }
  | { type: "REMOVE_MEMBER"; teamId: string; personId: string; actorId: string }
  | { type: "UPDATE_PROFILE"; personId: string; changes: Partial<Person> }
  | { type: "TOGGLE_CONNECTION"; personId: string; otherId: string }
  | { type: "MARK_NOTIFICATIONS_READ"; personId: string }
  | { type: "RESET" };
export type Transition = {
  state: DemoState;
  error?: string;
  message?: string;
  createdId?: string;
};
