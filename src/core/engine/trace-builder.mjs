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
      label: frame.purpose || (frame.depth === 0 ? 'root frame' : `frame ${frame.depth}`),
      status: frame.status || 'unknown',
      frameId: frame.frameId,
      depth: frame.depth,
      input: safePreview(frame.localState?.intents || []),
      output: safePreview({
        plan: frame.localState?.plan || null,
        partialResults: frame.localState?.partialResults || []
      }),
      metadata: {
        maxDepth: frame.maxDepth,
        seedCount: frame.seedIds?.length || 0
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
      error: branch.error || null
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

  return {
    rootFrameId: trace.rootFrameId || frames[0]?.frameId || null,
    nodes,
    edges
  };
}

