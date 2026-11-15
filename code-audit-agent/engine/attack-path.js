/**
 * Attack Path Generator
 *
 * Generates attack path graphs from vulnerability findings.
 * Enables red team perspective analysis of exploit chains.
 */

import fs from 'fs';
import path from 'path';

class AttackPathGenerator {
  constructor(config = {}) {
    this.projectRoot = config.projectRoot || process.cwd();
    this.outputDir = path.join(this.projectRoot, 'attack-paths');
  }

  /**
   * Generate attack path graph from vulnerabilities
   */
  generateAttackPaths(vulnerabilities, networkContext = {}) {
    const paths = {
      nodes: [],
      edges: [],
      summary: {
        totalPaths: 0,
        criticalPaths: 0,
        entryPoints: []
      }
    };

    // Create nodes for each vulnerability
    for (const vuln of vulnerabilities) {
      paths.nodes.push(this.createVulnNode(vuln));
    }

    // Add network/infrastructure nodes
    if (networkContext.internetFacing) {
      paths.nodes.push({
        id: 'internet',
        type: 'location',
        label: 'Internet',
        properties: { accessible: true }
      });
    }

    if (networkContext.internalNetwork) {
      paths.nodes.push({
        id: 'internal',
        type: 'location',
        label: 'Internal Network',
        properties: { accessible: false }
      });
    }

    // Create edges (attack relationships)
    for (const vuln of vulnerabilities) {
      const edges = this.createAttackEdges(vuln, vulnerabilities, networkContext);
      paths.edges.push(...edges);
    }

    // Identify critical attack chains
    const chains = this.identifyCriticalChains(paths.nodes, paths.edges);

    paths.summary.totalPaths = chains.length;
    paths.summary.criticalPaths = chains.filter(c => c.risk === 'CRITICAL').length;
    paths.summary.chains = chains;

    return paths;
  }

  /**
   * Create a node for a vulnerability
   */
  createVulnNode(vuln) {
    return {
      id: `vuln-${vuln.id || vuln.hash || Math.random().toString(36).substr(2, 9)}`,
      type: 'vulnerability',
      label: vuln.title || vuln.type,
      severity: vuln.severity || 'MEDIUM',
      properties: {
        cwe: vuln.cwe || 'N/A',
        confidence: vuln.confidence || 'MEDIUM',
        entryPoint: vuln.entryPoint || false,
        isAdmin: vuln.isAdmin || false,
        dataExposure: vuln.dataExposure || false,
        codeExecution: vuln.codeExecution || false
      }
    };
  }

  /**
   * Create attack edges from vulnerability
   */
  createAttackEdges(vuln, allVulns, context) {
    const edges = [];

    // Edge from internet to entry point vulnerability
    if (vuln.entryPoint && context.internetFacing) {
      edges.push({
        from: 'internet',
        to: `vuln-${vuln.id}`,
        label: 'HTTP Request',
        properties: { type: 'access' }
      });
    }

    // Privilege escalation edges
    if (vuln.codeExecution && !vuln.isAdmin) {
      edges.push({
        from: `vuln-${vuln.id}`,
        to: 'escalation-admin',
        label: 'Privilege Escalation',
        properties: { type: 'escalation' }
      });
    }

    // Lateral movement edges
    if (vuln.internalAccess) {
      edges.push({
        from: `vuln-${vuln.id}`,
        to: 'internal',
        label: 'Lateral Movement',
        properties: { type: 'lateral' }
      });
    }

    // Data exfiltration edges
    if (vuln.dataExposure) {
      edges.push({
        from: `vuln-${vuln.id}`,
        to: 'exfil',
        label: 'Data Access',
        properties: { type: 'exfiltration' }
      });
    }

    return edges;
  }

  /**
   * Identify critical attack chains
   */
  identifyCriticalChains(nodes, edges) {
    const chains = [];

    // Find chains from entry point to objective
    const entryNodes = nodes.filter(n => n.properties?.entryPoint);

    for (const entry of entryNodes) {
      const chain = this.buildAttackChain(entry, nodes, edges);
      if (chain.length > 0) {
        chains.push(chain);
      }
    }

    // Sort by risk score
    return chains.sort((a, b) => b.riskScore - a.riskScore);
  }

  /**
   * Build attack chain from entry point
   */
  buildAttackChain(entryNode, nodes, edges) {
    const chain = {
      id: `chain-${entryNode.id}`,
      entryPoint: entryNode.label,
      steps: [],
      riskScore: 0,
      risk: 'MEDIUM'
    };

    // Add entry point
    chain.steps.push({
      order: 1,
      node: entryNode.id,
      action: `Initial access via ${entryNode.label}`,
      skill: 'Basic',
      difficulty: 'LOW'
    });

    // Trace edges from entry point
    const outgoingEdges = edges.filter(e => e.from === entryNode.id);

    for (const edge of outgoingEdges) {
      chain.steps.push({
        order: 2,
        node: edge.to,
        action: edge.label,
        skill: 'Medium',
        difficulty: 'MEDIUM'
      });

      // Continue tracing if there's a next step
      const nextEdges = edges.filter(e => e.from === edge.to);
      for (const nextEdge of nextEdges) {
        chain.steps.push({
          order: 3,
          node: nextEdge.to,
          action: nextEdge.label,
          skill: 'Advanced',
          difficulty: 'HIGH'
        });
      }
    }

    // Calculate risk score
    chain.riskScore = this.calculateChainRisk(chain, nodes);
    chain.risk = this.getRiskRating(chain.riskScore);

    return chain;
  }

  /**
   * Calculate risk score for a chain
   */
  calculateChainRisk(chain, nodes) {
    let score = 10; // Base score

    for (const step of chain.steps) {
      const node = nodes.find(n => n.id === step.node);
      if (node) {
        // Reduce score for higher difficulty
        if (step.difficulty === 'HIGH') score -= 3;
        else if (step.difficulty === 'MEDIUM') score -= 1.5;

        // Reduce for higher skill requirement
        if (step.skill === 'Advanced') score -= 2;
        else if (step.skill === 'Medium') score -= 1;
      }
    }

    // Increase for high-severity nodes in chain
    const highSeverityNodes = chain.steps.filter(s => {
      const node = nodes.find(n => n.id === s.node);
      return node?.severity === 'CRITICAL' || node?.severity === 'HIGH';
    });

    score += highSeverityNodes.length * 0.5;

    return Math.max(0, score);
  }

  /**
   * Get risk rating from score
   */
  getRiskRating(score) {
    if (score >= 8) return 'CRITICAL';
    if (score >= 6) return 'HIGH';
    if (score >= 4) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate attack path graph in DOT format
   */
  generateDOTGraph(attackPaths) {
    let dot = 'digraph AttackPaths {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box, style=filled];\n\n';

    // Add nodes
    for (const node of attackPaths.nodes) {
      const color = this.getNodeColor(node.type, node.severity);
      dot += `  "${node.id}" [label="${node.label}", fillcolor="${color}"];\n`;
    }

    dot += '\n';

    // Add edges
    for (const edge of attackPaths.edges) {
      dot += `  "${edge.from}" -> "${edge.to}" [label="${edge.label}"];\n`;
    }

    dot += '}\n';

    return dot;
  }

  /**
   * Get node color based on type and severity
   */
  getNodeColor(type, severity) {
    if (type === 'vulnerability') {
      switch (severity) {
        case 'CRITICAL': return '#ff0000';
        case 'HIGH': return '#ff6600';
        case 'MEDIUM': return '#ffcc00';
        case 'LOW': return '#66ccff';
        default: return '#cccccc';
      }
    }
    if (type === 'location') {
      return '#999999';
    }
    return '#ffffff';
  }

  /**
   * Generate attack path report
   */
  generateReport(attackPaths) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: attackPaths.summary,
      criticalChains: attackPaths.summary.chains?.filter(c => c.risk === 'CRITICAL') || [],
      allPaths: attackPaths.summary.chains || []
    };

    // Save to file
    const outputPath = path.join(this.outputDir, `attack-paths-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    // Also save DOT graph
    const dotPath = path.join(this.outputDir, `attack-paths-${Date.now()}.dot`);
    fs.writeFileSync(dotPath, this.generateDOTGraph(attackPaths));

    return report;
  }

  /**
   * Export attack paths for visualization
   */
  exportForVisualization(attackPaths, format = 'json') {
    switch (format) {
      case 'dot':
        return this.generateDOTGraph(attackPaths);
      case 'json':
      default:
        return JSON.stringify(attackPaths, null, 2);
    }
  }
}

export function createAttackPathGenerator(config = {}) {
  return new AttackPathGenerator(config);
}

export default AttackPathGenerator;