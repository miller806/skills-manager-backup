/**
 * CVSS v3.1 Scorer
 *
 * Implements Common Vulnerability Scoring System v3.1 for standardized severity rating.
 * Provides accurate severity scores based on exploitability and impact metrics.
 */

class CVSSScorer {
  constructor() {
    // CVSS 3.1 Metric Values
    this.metrics = {
      attackVector: {
        'N': 0.85,  // Network
        'A': 0.62,  // Adjacent
        'L': 0.55,  // Local
        'P': 0.2    // Physical
      },
      attackComplexity: {
        'L': 0.77,  // Low
        'H': 0.62   // High
      },
      privilegesRequired: {
        'N': 0.85,  // None
        'L': 0.62,  // Low
        'H': 0.27   // High
      },
      userInteraction: {
        'N': 0.85,  // None
        'R': 0.62   // Required
      },
      scope: {
        'U': 'U',   // Unchanged
        'C': 'C'    // Changed
      },
      confidentialityImpact: {
        'H': 0.56,  // High
        'L': 0.22,  // Low
        'N': 0.0    // None
      },
      integrityImpact: {
        'H': 0.56,
        'L': 0.22,
        'N': 0.0
      },
      availabilityImpact: {
        'H': 0.56,
        'L': 0.22,
        'N': 0.0
      }
    };

    // Environmental metric weights
    this.envWeights = {
      confidentialityRequirement: { 'H': 1.5, 'M': 1.0, 'L': 0.5 },
      integrityRequirement: { 'H': 1.5, 'M': 1.0, 'L': 0.5 },
      availabilityRequirement: { 'H': 1.5, 'M': 1.0, 'L': 0.5 }
    };
  }

  /**
   * Calculate CVSS v3.1 Base Score
   */
  calculateBaseScore(vector) {
    const metrics = this.parseVector(vector);

    // Calculate Impact
    const iss = this.calculateISS(
      metrics.confidentialityImpact || 'N',
      metrics.integrityImpact || 'N',
      metrics.availabilityImpact || 'N'
    );

    // Calculate Scope
    const scopeChanged = metrics.scope === 'C';

    // Calculate Impact Sub-Score (IS)
    const impact = scopeChanged
      ? this.calculateImpactChanged(iss)
      : this.calculateImpactUnchanged(iss);

    // If impact is negative, return 0
    if (impact < 0) {
      return { score: 0, rating: 'None' };
    }

    // Calculate Exploitability
    const exploitability = this.calculateExploitability(metrics);

    // Calculate Base Score
    const baseScore = scopeChanged
      ? this.calculateBaseScoreChanged(impact, exploitability)
      : this.calculateBaseScoreUnchanged(impact, exploitability);

    return {
      score: Math.min(10.0, baseScore).toFixed(1),
      rating: this.getRating(baseScore),
      vector: vector,
      metrics: metrics
    };
  }

  /**
   * Calculate Impact Sub-Score (ISS)
   */
  calculateISS(conf, integ, avail) {
    const c = this.metrics.confidentialityImpact[conf] || 0;
    const i = this.metrics.integrityImpact[integ] || 0;
    const a = this.metrics.availabilityImpact[avail] || 0;

    return 1 - ((1 - c) * (1 - i) * (1 - a));
  }

  /**
   * Calculate Impact for Unchanged Scope
   */
  calculateImpactUnchanged(iss) {
    return 6.42 * iss;
  }

  /**
   * Calculate Impact for Changed Scope
   */
  calculateImpactChanged(iss) {
    return 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  }

  /**
   * Calculate Exploitability
   */
  calculateExploitability(metrics) {
    const av = this.metrics.attackVector[metrics.attackVector] || 0.85;
    const ac = this.metrics.attackComplexity[metrics.attackComplexity] || 0.77;
    const pr = this.metrics.privilegesRequired[metrics.privilegesRequired] || 0.85;
    const ui = this.metrics.userInteraction[metrics.userInteraction] || 0.85;

    // Adjust privileges based on scope
    let prValue = pr;
    if (metrics.scope === 'C') {
      if (pr === 0.85) prValue = 0.85;
      else if (pr === 0.62) prValue = 0.68;
      else if (pr === 0.27) prValue = 0.50;
    }

    return 8.22 * av * ac * prValue * ui;
  }

  /**
   * Calculate Base Score for Unchanged Scope
   */
  calculateBaseScoreUnchanged(impact, exploitability) {
    if (impact <= 0) {
      return 0;
    }
    return Math.min(10.0, 1.08 * (impact + exploitability));
  }

  /**
   * Calculate Base Score for Changed Scope
   */
  calculateBaseScoreChanged(impact, exploitability) {
    if (impact <= 0) {
      return 0;
    }
    return Math.min(10.0, 1.08 * (impact + exploitability) + 1.08);
  }

  /**
   * Parse CVSS vector string
   */
  parseVector(vector) {
    const metrics = {};
    const parts = vector.split('/');

    for (const part of parts) {
      const [key, value] = part.split(':');
      if (key && value) {
        metrics[key] = value;
      }
    }

    return metrics;
  }

  /**
   * Convert score to rating
   */
  getRating(score) {
    if (score >= 9.0) return 'Critical';
    if (score >= 7.0) return 'High';
    if (score >= 4.0) return 'Medium';
    if (score >= 0.1) return 'Low';
    return 'None';
  }

  /**
   * Calculate Temporal Score (adjust base for exploitability trends)
   */
  calculateTemporalScore(baseScore, vector) {
    const metrics = this.parseVector(vector);

    const exploitabilityPatches = {
      'X': 1.0,  // Not defined
      'O': 0.94, // Official fix
      'W': 0.91, // Workaround
      'U': 0.85, // Unavailable
      'T': 0.94  // Temporary fix
    };

    const remediationLevels = {
      'X': 1.0,
      'H': 0.95, // High
      'M': 0.92, // Medium
      'L': 0.90  // Low
    };

    const reportConfidence = {
      'X': 1.0,
      'C': 1.0,  // Confirmed
      'R': 0.96, // Reasonable
      'U': 0.92  // Unknown
    };

    const ep = exploitabilityPatches[metrics.E] || 1.0;
    const rl = remediationLevels[metrics.RL] || 1.0;
    const rc = reportConfidence[metrics.RC] || 1.0;

    return {
      score: (baseScore * ep * rl * rc).toFixed(1),
      rating: this.getRating(baseScore * ep * rl * rc)
    };
  }

  /**
   * Calculate Environmental Score
   */
  calculateEnvironmentalScore(baseScore, vector, envMetrics) {
    const metrics = this.parseVector(vector);

    // Calculate modified ISS
    const modifiedConf = this.applyEnvRequirement(
      metrics.confidentialityImpact || 'N',
      envMetrics.confidentialityRequirement || 'M'
    );
    const modifiedInteg = this.applyEnvRequirement(
      metrics.integrityImpact || 'N',
      envMetrics.integrityRequirement || 'M'
    );
    const modifiedAvail = this.applyEnvRequirement(
      metrics.availabilityImpact || 'N',
      envMetrics.availabilityRequirement || 'M'
    );

    const miss = this.calculateISS(modifiedConf, modifiedInteg, modifiedAvail);

    // Calculate modified impact
    const scopeChanged = metrics.scope === 'C';
    const mImpact = scopeChanged
      ? this.calculateImpactChanged(miss) - 3.25
      : this.calculateImpactUnchanged(miss);

    // Calculate modified exploitability
    const mav = metrics.attackVector === 'N' ? 0.85 :
                metrics.attackVector === 'A' ? 0.62 :
                metrics.attackVector === 'L' ? 0.55 : 0.2;

    const mac = metrics.attackComplexity === 'L' ? 0.77 : 0.62;

    // Modified PR for environmental
    let mpr = metrics.privilegesRequired === 'N' ? 0.85 :
              metrics.privilegesRequired === 'L' ? 0.62 : 0.27;

    if (scopeChanged) {
      mpr = metrics.privilegesRequired === 'N' ? 0.85 :
            metrics.privilegesRequired === 'L' ? 0.68 : 0.50;
    }

    const mui = metrics.userInteraction === 'N' ? 0.85 : 0.62;

    const mExploitability = 8.22 * mav * mac * mpr * mui;

    // Calculate environmental score
    let envScore;
    if (mImpact <= 0) {
      envScore = 0;
    } else {
      envScore = scopeChanged
        ? Math.min(10.0, 1.08 * (mImpact + mExploitability) + 1.08)
        : Math.min(10.0, Math.min(1.08 * (mImpact + mExploitability), 10));
    }

    return {
      score: envScore.toFixed(1),
      rating: this.getRating(envScore),
      baseScore: baseScore
    };
  }

  /**
   * Apply environmental requirement modifier
   */
  applyEnvRequirement(baseValue, requirement) {
    const weights = this.envWeights;

    if (requirement === 'H') {
      // High requirement - can increase impact
      return baseValue === 'H' ? 'H' : baseValue === 'L' ? 'M' : baseValue;
    } else if (requirement === 'L') {
      // Low requirement - can decrease impact
      return baseValue === 'H' ? 'M' : baseValue === 'L' ? 'N' : baseValue;
    }
    return baseValue; // Medium requirement - no change
  }

  /**
   * Generate CVSS vector from vulnerability properties
   */
  generateVector(vuln) {
    const parts = [];

    parts.push(`AV:${vuln.attackVector || 'N'}`);
    parts.push(`AC:${vuln.attackComplexity || 'L'}`);
    parts.push(`PR:${vuln.privilegesRequired || 'N'}`);
    parts.push(`UI:${vuln.userInteraction || 'N'}`);
    parts.push(`S:${vuln.scope || 'U'}`);
    parts.push(`C:${vuln.confidentiality || 'H'}`);
    parts.push(`I:${vuln.integrity || 'H'}`);
    parts.push(`A:${vuln.availability || 'H'}`);

    return parts.join('/');
  }

  /**
   * Calculate score from vulnerability properties
   */
  scoreFromProperties(vuln) {
    const vector = this.generateVector(vuln);
    return this.calculateBaseScore(vector);
  }
}

export function createCVSSScorer() {
  return new CVSSScorer();
}

export default CVSSScorer;