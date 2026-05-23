export type Role = 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface Competency {
  name: string;
  score: number;
  evidence: string;
  gap: boolean;
}

export interface Assessment {
  competencies: Competency[];
  next_focus: string;
  overall: number;
}
