/* ============================================
   Shared Queue Management Types
   ============================================ */

// ── Auth / Identity ──

export type Membership = {
  id: string;
  role: string;
  organization: { id: string; name: string };
  branchId: string | null;
};

export type User = {
  displayName: string;
  email: string;
  memberships: Membership[];
};

// ── Core Entities ──

export type Branch = {
  id: string;
  name: string;
  code: string | null;
};

export type Department = {
  id: string;
  name: string;
};

export type Service = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  departmentId: string;
};

export type Patient = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
};

export type PriorityConfig = {
  level: string;
  weight: number;
  active: boolean;
};

// ── Token / Queue ──

export type TokenStatus = 'WAITING' | 'CALLED' | 'SERVING' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';

export type Token = {
  id: string;
  displayNumber: string;
  sequenceNumber: number;
  businessDate: string;
  status: TokenStatus;
  issuedAt: string;
  calledAt: string | null;
  servingAt: string | null;
  completedAt: string | null;
  recallCount: number;
  counter: { id: string; name: string; code: string } | null;
  operator: { id: string; displayName: string } | null;
  queueEntry: {
    priority: string;
    patient: {
      patientNumber: string;
      firstName: string;
      lastName: string;
    };
    service: {
      name: string;
      department: { name: string };
    };
  };
};

export type TokenListMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  businessDate: string;
};

export type TokenListResponse = {
  data: Token[];
  meta: TokenListMeta;
};

// ── Counter ──

export type Counter = {
  id: string;
  branchId: string;
  name: string;
  code: string;
  status: string;
};

export type WaitingResponse = {
  data: Token[];
  meta: { total: number };
};

// ── Public Display ──

export type PublicToken = {
  tokenLabel: string;
  counter: string;
  status: TokenStatus;
  service?: string;
  department?: string;
  recalled: boolean;
  recallCount: number;
  calledAt: string | null;
};

export type DisplaySnapshot = {
  display: { name: string };
  current: PublicToken | null;
  recent: PublicToken[];
  waitingSummary: { total: number };
  updatedAt: string;
};

// ── Print Ticket ──

export type PrintTicket = {
  organization: { name: string };
  branch: { name: string; code: string | null };
  token: { displayNumber: string; businessDate: string; issuedAt: string; status: string };
  department: { name: string };
  service: { name: string };
  counter: { name: string; code: string } | null;
  printedAt: string;
};

// ── Page State ──

export type PageState = 'loading' | 'ready' | 'error' | 'forbidden';
export type CounterPageState = PageState | 'reconnecting' | 'empty';
export type DisplayPageState = 'loading' | 'ready' | 'reconnecting' | 'error';
