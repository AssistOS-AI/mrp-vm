function safePreview(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pushNode(target, seen, node) {
  if (!node?.id || seen.has(node.id)) return;
  seen.add(node.id);
  target.push(node);
}

function pushEdge(target, seen, edge) {
  if (!edge?.from || !edge?.to || !edge?.type) return;
  const key = `${edge.type}:${edge.from}:${edge.to}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(edge);
}

export function buildExecutionGraph(trace = {}) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();

  const frames = Array.isArray(trace.frames) ? trace.frames : [];
  const branches = Array.isArray(trace.branches) ? trace.branches : [];
  const results = Array.isArray(trace.results) ? trace.results : [];
  const failures = Array.isArray(trace.failures) ? trace.failures : [];
  const stages = Array.isArray(trace.stages) ? trace.stages : [];

  for (const frame of frames) {
    pushNode(nodes, seenNodes, {
      id: frame.frameId,
      type: 'frame',
      label: `frame ${frame.depth ?? 0}`,
      status: frame.status || 'unknown',
      frameId: frame.frameId,
      depth: frame.depth,
      input: safePreview(frame.localState?.intents || []),
      output: safePreview({
        plan: frame.localState?.plan || null,
        partialResults: frame.localState?.partialResults || [],
        candidateCount: frame.candidateSet?.length || 0
      }),
      metadata: {
        purpose: frame.purpose || null,
        maxDepth: frame.maxDepth,
        seedCount: frame.seedIds?.length || 0,
        deliberationLevel: frame.deliberationPolicy?.level ?? 0,
        closureMode: frame.deliberationPolicy?.closureMode || null,
        frontier: frame.explorationFrontier?.length || 0,
        candidates: frame.candidateSet?.length || 0
      }
    });
    if (frame.parentFrameId) {
      pushEdge(edges, seenEdges, {
        type: 'spawned_from',
        from: frame.parentFrameId,
        to: frame.frameId
      });
    }

    for (const seed of frame.seedDetails || []) {
      const seedNodeId = `${frame.frameId}:seed:${seed.seedId}`;
      pushNode(nodes, seenNodes, {
        id: seedNodeId,
        type: 'seed',
        label: seed.focus || seed.seedId,
        status: seed.status || 'active',
        frameId: frame.frameId,
        seedId: seed.seedId,
        input: safePreview({
          intentId: seed.intentId || null,
          intentRef: seed.intentGroupNumber || null,
          mode: seed.mode || null,
          action: seed.action || null
        }),
        output: safePreview({
          domain: seed.domain || null,
          evidenceNeed: seed.evidenceNeed || null,
          priority: seed.priority || null
        }),
        metadata: {
          splitFrom: seed.splitFrom || null
        }
      });
      pushEdge(edges, seenEdges, {
        type: 'contains',
        from: frame.frameId,
        to: seedNodeId
      });
      if (seed.splitFrom) {
        pushEdge(edges, seenEdges, {
          type: 'spawned_from',
          from: `${frame.frameId}:seed:${seed.splitFrom}`,
          to: seedNodeId
        });
      }
    }

    const policyNodeId = `${frame.frameId}:policy`;
    pushNode(nodes, seenNodes, {
      id: policyNodeId,
      type: 'policy',
      label: `deliberation L${frame.deliberationPolicy?.level ?? 0}`,
      status: frame.deliberationStatus || 'configured',
      frameId: frame.frameId,
      input: safePreview(frame.deliberationPolicy || {}),
      output: safePreview({
        frontier: frame.explorationFrontier || [],
        suspended: frame.suspendedSet || []
      }),
      metadata: {
        closureMode: frame.deliberationPolicy?.closureMode || null,
        validationFloor: frame.deliberationPolicy?.validationFloor || null
      }
    });
    pushEdge(edges, seenEdges, {
      type: 'contains',
      from: frame.frameId,
      to: policyNodeId
    });
  }

  stages.forEach((stage, index) => {
    const pluginNodeId = `plugin:${index}`;
    pushNode(nodes, seenNodes, {
      id: pluginNodeId,
      type: 'plugin',
      label: stage.pluginId || stage.stage || 'plugin',
      status: stage.status || 'unknown',
      frameId: stage.frameId || trace.rootFrameId || frames[0]?.frameId || null,
      stage: stage.stage || 'stage',
      input: stage.inputSnippet || null,
      output: stage.outputSnippet || null,
      error: stage.error || null,
      metadata: {
        durationMs: stage.durationMs ?? null,
        llmCalls: stage.llmCalls ?? null,
        model: stage.model || null,
        plannerPluginId: stage.plannerPluginId || null,
        kbPluginId: stage.kbPluginId || null
      }
    });
    pushEdge(edges, seenEdges, {
      type: 'contains',
      from: stage.frameId || trace.rootFrameId || frames[0]?.frameId || null,
      to: pluginNodeId
    });
  });

  for (const branch of branches) {
    const branchNodeId = `branch:${branch.branchId}`;
    pushNode(nodes, seenNodes, {
      id: branchNodeId,
      type: 'branch',
      label: branch.pluginId || branch.branchId,
      status: branch.status || 'unknown',
      frameId: branch.frameId,
      branchId: branch.branchId,
      input: safePreview({
        intentId: branch.intentId,
        seedId: branch.seedId,
        kbPluginId: branch.kbPluginId,
        validationId: branch.validationId
      }),
      output: branch.outputPreview || null,
      error: branch.error || null,
      metadata: {
        familySignature: branch.familySignature || null
      }
    });
    pushEdge(edges, seenEdges, {
      type: 'contains',
      from: branch.frameId,
      to: branchNodeId
    });
    if (branch.seedId) {
      pushEdge(edges, seenEdges, {
        type: 'spawned_from',
        from: `${branch.frameId}:seed:${branch.seedId}`,
        to: branchNodeId
      });
    }
    if (branch.validationId) {
      pushEdge(edges, seenEdges, {
        type: 'needs',
        from: branchNodeId,
        to: `validation:${branch.validationId}`
      });
    }
    if (branch.stageTraceIndex != null) {
      pushEdge(edges, seenEdges, {
        type: 'uses',
        from: branchNodeId,
        to: `plugin:${branch.stageTraceIndex}`
      });
    }
  }

  for (const result of results) {
    const resultNodeId = `result:${result.resultId}`;
    pushNode(nodes, seenNodes, {
      id: resultNodeId,
      type: 'result',
      label: result.kind || 'result',
      status: result.validationStatus || 'success',
      frameId: result.frameId,
      resultId: result.resultId,
      input: null,
      output: result.body || null,
      metadata: {
        preservesConstraints: result.preservesConstraints,
        structuralComplete: result.structuralComplete
      }
    });
    pushEdge(edges, seenEdges, {
      type: 'produced',
      from: `branch:${result.branchId}`,
      to: resultNodeId
    });
    for (const supportId of result.supportIds || []) {
      pushEdge(edges, seenEdges, {
        type: 'uses',
        from: resultNodeId,
        to: supportId
      });
    }
  }

  for (const failure of failures) {
    const failureNodeId = `failure:${failure.failureId}`;
    pushNode(nodes, seenNodes, {
      id: failureNodeId,
      type: 'failure',
      label: failure.pluginId || 'failure',
      status: 'failed',
      frameId: failure.frameId,
      failureId: failure.failureId,
      input: null,
      output: failure.reason || null,
      error: failure.error || null,
      metadata: {
        evidenceProfileHash: failure.evidenceProfileHash || null
      }
    });
    pushEdge(edges, seenEdges, {
      type: 'failed_as',
      from: `branch:${failure.branchId}`,
      to: failureNodeId
    });
  }

  for (const frame of frames) {
    for (const candidate of frame.candidateSet || []) {
      const candidateNodeId = `candidate:${candidate.candidateId}`;
      pushNode(nodes, seenNodes, {
        id: candidateNodeId,
        type: 'candidate',
        label: candidate.label || candidate.candidateId,
        status: candidate.validationStatus || candidate.strength || 'candidate',
        frameId: frame.frameId,
        input: safePreview({
          resultId: candidate.resultId || null,
          branchId: candidate.branchId || null,
          familySignature: candidate.familySignature || null
        }),
        output: safePreview({
          score: candidate.score ?? null,
          selected: !!candidate.selected,
          strength: candidate.strength || null
        }),
        metadata: {
          selected: !!candidate.selected,
          strength: candidate.strength || null,
          familySignature: candidate.familySignature || null
        }
      });
      pushEdge(edges, seenEdges, {
        type: 'contains',
        from: frame.frameId,
        to: candidateNodeId
      });
      if (candidate.resultId) {
        pushEdge(edges, seenEdges, {
          type: 'derived_from',
          from: candidateNodeId,
          to: `result:${candidate.resultId}`
        });
      }
      if (candidate.branchId) {
        pushEdge(edges, seenEdges, {
          type: 'spawned_from',
          from: `branch:${candidate.branchId}`,
          to: candidateNodeId
        });
      }
    }

    for (const comparison of frame.comparisonState?.openComparisons || []) {
      const comparisonNodeId = `comparison:${comparison.comparisonId}`;
      pushNode(nodes, seenNodes, {
        id: comparisonNodeId,
        type: 'comparison',
        label: comparison.label || comparison.comparisonId,
        status: comparison.status || 'open',
        frameId: frame.frameId,
        input: safePreview({
          candidateIds: comparison.candidateIds || [],
          objectiveId: comparison.objectiveId || null
        }),
        output: safePreview(comparison.summary || null),
        metadata: {
          criterion: comparison.criterion || null
        }
      });
      pushEdge(edges, seenEdges, {
        type: 'contains',
        from: frame.frameId,
        to: comparisonNodeId
      });
      for (const candidateId of comparison.candidateIds || []) {
        pushEdge(edges, seenEdges, {
          type: 'compares',
          from: comparisonNodeId,
          to: `candidate:${candidateId}`
        });
      }
    }

    for (const challenge of frame.comparisonState?.challenges || []) {
      const challengeNodeId = `challenge:${challenge.challengeId}`;
      pushNode(nodes, seenNodes, {
        id: challengeNodeId,
        type: 'challenge',
        label: challenge.label || challenge.challengeId,
        status: challenge.status || 'open',
        frameId: frame.frameId,
        input: safePreview({
          targetId: challenge.targetId || null,
          kind: challenge.kind || null
        }),
        output: safePreview(challenge.prompt || challenge.resolution || null),
        metadata: {
          severity: challenge.severity || null
        }
      });
      pushEdge(edges, seenEdges, {
        type: 'contains',
        from: frame.frameId,
        to: challengeNodeId
      });
      if (challenge.targetId) {
        pushEdge(edges, seenEdges, {
          type: 'challenges',
          from: challengeNodeId,
          to: challenge.targetId.startsWith('candidate:')
            ? challenge.targetId
            : `candidate:${challenge.targetId}`
        });
      }
    }
  }

  return {
    rootFrameId: trace.rootFrameId || frames[0]?.frameId || null,
    nodes,
    edges
  };
}
