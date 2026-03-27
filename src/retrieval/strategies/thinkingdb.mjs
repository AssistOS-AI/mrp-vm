import { RetrievalStrategy } from './registry.mjs';
import { ThinkingDB } from '../thinkingdb.mjs';

export class ThinkingDBSymbolicStrategy extends RetrievalStrategy {
  constructor(config = {}) {
    super();
    this.config = config;
    this.rules = config.rules || [];
  }

  getId() { return 'thinkingdb-symbolic'; }
  getKind() { return 'symbolic'; }
  getCostClass() { return 'moderate'; }
  supportsParallelExecution() { return false; }

  async retrieve({ contextProfile, currentTurnUnits, sessionIndex, kbIndex, budget }) {
    const start = Date.now();
    const db = new ThinkingDB(this.config);
    db.registerRules(this.rules);

    for (const unit of currentTurnUnits || []) db.addUnit(unit, 'current-turn');
    if (sessionIndex) for (const [, unit] of sessionIndex.units) db.addUnit(unit, 'session');
    if (kbIndex) for (const [, unit] of kbIndex.units) db.addUnit(unit, 'kb');

    const result = db.query(contextProfile, {
      maxDepth: this.config.maxDepth,
      maxCandidates: budget?.maxCandidates || contextProfile.maxResults || 10
    });

    return {
      strategyId: 'thinkingdb-symbolic',
      candidates: result.candidates.filter(c => c.store !== 'current-turn'),
      durationMs: Date.now() - start,
      exhaustedBudget: false
    };
  }
}
