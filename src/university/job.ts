import type { Config } from '../config.js';
import { runDeliveryJob, type Dependencies } from '../job.js';
import { collectUniversity } from './fetch.js';
import { reminderGames, renderUniversity } from './render.js';
import type { UniversitySnapshot } from './schedule.js';
export function runUniversityJob(config: Config, overrides: Partial<Dependencies<UniversitySnapshot>> = {}): Promise<number> {
  return runDeliveryJob(config, {
    key: 'university-home-volleyball', label: 'University volleyball', collect: collectUniversity,
    needsHealthReport: (snapshot, config) => reminderGames(snapshot, config.date).length === 0,
    render: renderUniversity, summary: snapshot => ({ sources: snapshot.sources }),
  }, overrides);
}
