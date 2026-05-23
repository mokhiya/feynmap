export type Role = 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface SourceRef {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  page?: number | null;
}

export interface Competency {
  name: string;
  score: number;
  criterion?: string;
  evidence: string;
  gap: boolean;
  source_refs?: SourceRef[];
  overridden?: boolean;
}

export interface Assessment {
  competencies: Competency[];
  next_focus: string;
  overall: number;
  strengths?: string[];
  growth_zones?: string[];
  recommendations?: string[];
}

export type SessionMode = 'practice' | 'assessment';

export type SessionStatus =
  | 'in_progress'
  | 'auto_scored'
  | 'pending_review'
  | 'finalized'
  | 'abandoned';

export interface SessionRow {
  id: string;
  orgId: string;
  userId: string;
  topicId: string | null;
  topicLabel: string;
  mode: SessionMode;
  status: SessionStatus;
  locale: string;
  transcript: Message[];
  flags: Record<string, number>;
  wellbeing: Record<string, any>;
  docVersions: Record<string, number>;
  startedAt: string;
  finalizedAt: string | null;
}

export interface TopicRow {
  id: string;
  name: string;
  description: string;
  locale: 'ru' | 'en' | 'uz';
}

export interface DocumentRow {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  status: 'uploaded' | 'parsing' | 'indexed' | 'failed';
  error: string | null;
  version: number;
  chunkCount: number;
  createdAt: string;
}
