import { looksLikeSOPDocument } from '../parser/cnl-validator-parser.mjs';
import {
  createBranchAttempt,
  createTraceFailure,
  createTraceResult
} from './runtime-objects.mjs';

export const traceStateHelperMethods = {
  _allocateFrameId(requestId, executionTrace) {
    const next = executionTrace._frameSequence || 0;
    executionTrace._frameSequence = next + 1;
    return `frame-${requestId}-${next}`;
  },

  _normalizeSeedDetails(intentGroups = [], interpretedIntentDoc = null, frameId = 'frame') {
    if (interpretedIntentDoc?.seeds?.size) {
      const intentIds = [...interpretedIntentDoc.intents.keys()];
      const groupNumberByIntentId = new Map(intentIds.map((id, index) => [id, index + 1]));
      return [...interpretedIntentDoc.seeds.values()].map(seed => ({
        seedId: seed.id,
        intentId: seed.intentId || null,
        intentGroupNumber: groupNumberByIntentId.get(seed.intentId) || null,
        mode: seed.mode || null,
        action: seed.action || null,
        focus: seed.focus || null,
        domain: seed.domain || null,
        evidenceNeed: seed.evidenceNeed || null,
        priority: seed.priority || null,
        status: seed.state || seed.status || 'active',
        splitFrom: seed.splitFrom || null
      }));
    }
    return intentGroups.map(group => ({
      seedId: `seed-${frameId}-${group.groupNumber}`,
      intentId: group.intentId || `intent-${group.groupNumber}`,
      intentGroupNumber: group.groupNumber,
      mode: 'direct',
      action: group.act || 'explain',
      focus: group.intent,
      domain: 'chat_turn',
      evidenceNeed: 'general',
      priority: null,
      status: 'active',
      splitFrom: null
    }));
  },

  _admitSeedDocuments(seedResult, frameId) {
    const intentGroups = this.parser.parseIntentCNL(seedResult.intentCNL);
    let interpretedIntentDoc = null;
    if (typeof this.parser.interpretDocument === 'function' && looksLikeSOPDocument(seedResult.intentCNL)) {
      interpretedIntentDoc = this.parser.interpretDocument(seedResult.intentCNL, { documentKind: 'intent' });
    }

    let currentTurnUnits = [];
    let interpretedContextDoc = null;
    if (seedResult.currentTurnContextCNL?.trim()) {
      currentTurnUnits = this.parser.parseContextCNL(seedResult.currentTurnContextCNL);
      if (typeof this.parser.interpretDocument === 'function' && looksLikeSOPDocument(seedResult.currentTurnContextCNL)) {
        interpretedContextDoc = this.parser.interpretDocument(seedResult.currentTurnContextCNL, { documentKind: 'context' });
      }
    }

    return {
      intentGroups,
      currentTurnUnits,
      interpretedIntentDoc,
      interpretedContextDoc,
      seedDetails: this._normalizeSeedDetails(intentGroups, interpretedIntentDoc, frameId)
    };
  },

  _ensureFrameRecord(executionTrace, frameRecord) {
    const existing = executionTrace.frames.find(frame => frame.frameId === frameRecord.frameId);
    if (existing) return existing;
    executionTrace.frames.push(frameRecord);
    if (!executionTrace.rootFrameId) executionTrace.rootFrameId = frameRecord.frameId;
    return frameRecord;
  },

  _patchFrameRecord(executionTrace, frameId, patch = {}) {
    const frame = executionTrace.frames.find(item => item.frameId === frameId);
    if (!frame) return null;
    Object.assign(frame, patch);
    if (patch.seedDetails) {
      frame.seedDetails = [...patch.seedDetails];
      frame.seedIds = patch.seedDetails.map(seed => seed.seedId);
    }
    if (patch.localState) {
      frame.localState = {
        ...frame.localState,
        ...patch.localState
      };
    }
    if (patch.budgets) {
      frame.budgets = {
        ...frame.budgets,
        ...patch.budgets
      };
    }
    if (patch.deliberationPolicy) {
      frame.deliberationPolicy = {
        ...frame.deliberationPolicy,
        ...patch.deliberationPolicy
      };
    }
    if (patch.candidateSet) frame.candidateSet = [...patch.candidateSet];
    if (patch.explorationFrontier) frame.explorationFrontier = [...patch.explorationFrontier];
    if (patch.suspendedSet) frame.suspendedSet = [...patch.suspendedSet];
    if (patch.branchFamilies) {
      frame.branchFamilies = {
        ...frame.branchFamilies,
        ...patch.branchFamilies
      };
    }
    if (patch.comparisonState) {
      frame.comparisonState = {
        ...frame.comparisonState,
        ...patch.comparisonState,
        openComparisons: [...(patch.comparisonState.openComparisons || frame.comparisonState.openComparisons || [])],
        resolvedDifferences: [...(patch.comparisonState.resolvedDifferences || frame.comparisonState.resolvedDifferences || [])],
        openQuestions: [...(patch.comparisonState.openQuestions || frame.comparisonState.openQuestions || [])],
        challenges: [...(patch.comparisonState.challenges || frame.comparisonState.challenges || [])]
      };
    }
    return frame;
  },

  _recordBranchAttempt(executionTrace, details = {}) {
    const branch = createBranchAttempt({
      branchId: `branch-${executionTrace.branches.length + 1}`,
      ...details
    });
    executionTrace.branches.push(branch);
    const frame = executionTrace.frames.find(item => item.frameId === branch.frameId);
    if (frame && !frame.activeBranchIds.includes(branch.branchId)) {
      frame.activeBranchIds.push(branch.branchId);
      if (!frame.explorationFrontier.includes(branch.branchId)) {
        frame.explorationFrontier.push(branch.branchId);
      }
      if (branch.familySignature) {
        frame.branchFamilies[branch.branchId] = branch.familySignature;
      }
    }
    return branch;
  },

  _patchBranchAttempt(executionTrace, branchId, patch = {}) {
    const branch = executionTrace.branches.find(item => item.branchId === branchId);
    if (!branch) return null;
    Object.assign(branch, patch);
    const frame = executionTrace.frames.find(item => item.frameId === branch.frameId);
    if (frame && ['succeeded', 'failed'].includes(branch.status)) {
      frame.activeBranchIds = frame.activeBranchIds.filter(id => id !== branchId);
      frame.explorationFrontier = frame.explorationFrontier.filter(id => id !== branchId);
      if (!frame.completedBranchIds.includes(branchId)) frame.completedBranchIds.push(branchId);
    }
    return branch;
  },

  _recordFailure(executionTrace, details = {}) {
    const failure = createTraceFailure({
      failureId: `failure-${executionTrace.failures.length + 1}`,
      ...details
    });
    executionTrace.failures.push(failure);
    const frame = executionTrace.frames.find(item => item.frameId === failure.frameId);
    if (frame) {
      frame.failureMemory.push({
        branchId: failure.branchId,
        seedId: failure.seedId,
        pluginId: failure.pluginId,
        reason: failure.reason,
        evidenceProfileHash: failure.evidenceProfileHash || null
      });
    }
    return failure;
  },

  _recordResult(executionTrace, details = {}) {
    const result = createTraceResult({
      resultId: `result-${executionTrace.results.length + 1}`,
      ...details
    });
    executionTrace.results.push(result);
    return result;
  }
};
