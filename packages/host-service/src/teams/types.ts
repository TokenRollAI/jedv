import type { MailService } from "../mail/service";
import type { TeamService } from "./service";

export type { Team, TeamMember } from "./service";
export type TeamStatusResult = ReturnType<TeamService["status"]>;
export type TeamListResult = ReturnType<TeamService["list"]>;
export type MailSendResult = ReturnType<MailService["send"]>;
export type MailInboxResult = ReturnType<MailService["inbox"]>;
export type MailReadResult = ReturnType<MailService["consume"]>;
export type MailTimelineResult = ReturnType<MailService["timeline"]>;
