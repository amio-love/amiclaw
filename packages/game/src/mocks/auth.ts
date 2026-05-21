/* Mock signed-in user for the development phase — there is no real auth
   backend yet. Consumed by useAuth / TopNav (and, in later phases,
   WelcomeStrip / AccountPage). */

export interface MockUser {
  displayName: string
  avatarLetter: string
  streakDays: number
  completed: number
  fastest: string
  weekRank: number
  totalRank: number
  lastDefuse: string
}

export const mockUser: MockUser = {
  displayName: '星海',
  avatarLetter: '林',
  streakDays: 6,
  completed: 42,
  fastest: '02:14',
  weekRank: 247,
  totalRank: 1402,
  lastDefuse: '02:14',
}
