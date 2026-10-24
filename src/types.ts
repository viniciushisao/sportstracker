export type Competition = 'men' | 'women';
export interface Team { id: string; name: string }
export interface Match {
  id: string; competition: Competition; season: string; phase: string;
  home: Team; away: Team; startsAt: string; status: 'scheduled' | 'live' | 'finished' | 'postponed';
  broadcasters: string[];
  homeSets: number | null; awaySets: number | null; sourceUrl: string;
}
export interface Standing { rank: number; team: Team; points: number; played: number; wins: number; losses: number }
export interface CompetitionData {
  competition: Competition; season: string; championshipId: number;
  matches: Match[]; standings: Standing[]; sourceUrl: string; standingsUrl: string;
  sourceUpdatedAt: string | null; rounds: string[];
  firstLegOnly?: boolean;
  coverageWarnings?: string[];
}
export interface Snapshot { fetchedAt: string; competitions: CompetitionData[] }
export interface Email { subject: string; text: string; html?: string }
