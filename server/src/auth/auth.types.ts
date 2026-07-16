import type { Request } from 'express'

export interface GithubUserProfile {
  id: string
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface AuthUser {
  id: string
  displayName: string
  avatarUrl: string | null
  githubLogin: string
}

export interface AuthSessionContext {
  sessionId: string
  csrfTokenHash: string
  user: AuthUser
}

export interface AuthenticatedRequest extends Request {
  auth: AuthSessionContext
}
