/**
 * Business Risk Calculator
 *
 * Calculates business risk based on vulnerability impact,
 * exposure, and asset value.
 */

class RiskCalculator {
  constructor(config = {}) {
    this.industry = config.industry || 'general';
    this.dataSensitivity = config.dataSensitivity || 'medium';
  }

  /**
   * Calculate business risk score
   */
  calculateBusinessRisk(vuln, context = {}) {
    const {
      likelihood = 0.7,      // Likelihood of exploitation (0-1)
      assetValue = 5,         // Value of affected asset (1-10)
      regulatoryExposure = false,
      reputationalImpact = 'medium'
    } = context;

    // Base risk from vulnerability severity
    const baseRisk = this.severityToRisk(vuln.severity);

    // Adjust for likelihood
    const likelihoodFactor = this.mapLikelihood(likelihood);

    // Adjust for asset value
    const assetFactor = assetValue / 10;

    // Regulatory multiplier
    const regulatoryFactor = regulatoryExposure ? 1.5 : 1.0;

    // Reputational multiplier
    const reputationalFactor = this.mapReputation(reputationalImpact);

    // Calculate final risk
    const riskScore = baseRisk * likelihoodFactor * assetFactor * regulatoryFactor * reputationalFactor;

    return {
      score: Math.min(100, Math.round(riskScore * 10) / 10),
      rating: this.getRiskRating(riskScore),
      factors: {
        baseRisk,
        likelihoodFactor,
        assetFactor,
        regulatoryFactor,
        reputationalFactor
      }
    };
  }

  /**
   * Map severity string to numeric risk
   */
  severityToRisk(severity) {
    const map = {
      'CRITICAL': 10,
      'HIGH': 7.5,
      'MEDIUM': 5,
      'LOW': 2.5,
      'INFO': 1
    };
    return map[severity?.toUpperCase()] || 5;
  }

  /**
   * Map likelihood to factor
   */
  mapLikelihood(likelihood) {
    if (likelihood >= 0.9) return 1.0;
    if (likelihood >= 0.7) return 0.9;
    if (likelihood >= 0.5) return 0.7;
    if (likelihood >= 0.3) return 0.5;
    return 0.3;
  }

  /**
   * Map reputational impact to factor
   */
  mapReputation(impact) {
    const map = {
      'critical': 1.5,
      'high': 1.2,
      'medium': 1.0,
      'low': 0.8
    };
    return map[impact?.toLowerCase()] || 1.0;
  }

  /**
   * Get risk rating from score
   */
  getRiskRating(score) {
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    if (score >= 20) return 'LOW';
    return 'MINIMAL';
  }

  /**
   * Calculate data breach cost estimate
   */
  estimateBreachCost(vuln, recordCount = 0) {
    const perRecordCost = {
      'PII': 180,          // USD per record
      'financial': 250,
      'health': 400,
      'generic': 150
    };

    const dataType = this.identifyDataType(vuln);
    const costPerRecord = perRecordCost[dataType] || perRecordCost.generic;

    const baseCost = recordCount * costPerRecord;

    // Industry multiplier
    const industryMultiplier = this.getIndustryMultiplier();

    return {
      estimatedCost: baseCost * industryMultiplier,
      perRecordCost,
      recordCount,
      dataType,
      industryMultiplier
    };
  }

  /**
   * Identify data type affected by vulnerability
   */
  identifyDataType(vuln) {
    const typeMap = {
      'PII': ['user', 'email', 'phone', 'address', 'ssn'],
      'financial': ['payment', 'card', 'credit', 'bank', 'account'],
      'health': ['medical', 'health', 'patient', 'diagnosis']
    };

    const description = (vuln.description || '').toLowerCase();

    for (const [type, keywords] of Object.entries(typeMap)) {
      if (keywords.some(k => description.includes(k))) {
        return type;
      }
    }

    return 'generic';
  }

  /**
   * Get industry multiplier for breach cost
   */
  getIndustryMultiplier() {
    const multipliers = {
      'healthcare': 2.0,
      'financial': 1.8,
      'retail': 1.5,
      'technology': 1.3,
      'general': 1.0
    };
    return multipliers[this.industry?.toLowerCase()] || 1.0;
  }

  /**
   * Calculate remediation cost
   */
  estimateRemediationCost(vuln) {
    const complexityFactor = {
      'CRITICAL': 3,
      'HIGH': 2,
      'MEDIUM': 1.5,
      'LOW': 1
    };

    const baseHours = {
      'sql_injection': 8,
      'xss': 4,
      'authentication': 12,
      'authorization': 6,
      'cryptography': 16,
      'configuration': 2
    };

    const type = vuln.type?.toLowerCase() || 'generic';
    const severity = vuln.severity?.toUpperCase() || 'MEDIUM';

    const hours = baseHours[type] || 4;
    const complexity = complexityFactor[severity] || 1;

    const developerRate = 100; // USD per hour

    return {
      estimatedHours: hours * complexity,
      developerRate,
      estimatedCost: hours * complexity * developerRate
    };
  }

  /**
   * Calculate ROI of remediation
   */
  calculateRemediationROI(vuln, context = {}) {
    const { likelihood = 0.7, recordCount = 0 } = context;

    const breachCost = this.estimateBreachCost(vuln, recordCount);
    const remediationCost = this.estimateRemediationCost(vuln);

    const expectedLoss = breachCost.estimatedCost * likelihood;
    const roi = ((expectedLoss - remediationCost.estimatedCost) / remediationCost.estimatedCost) * 100;

    return {
      breachCost: breachCost.estimatedCost,
      remediationCost: remediationCost.estimatedCost,
      expectedLoss,
      roi: roi.toFixed(1) + '%',
      recommendation: roi > 100 ? 'HIGH ROI - Immediate remediation' :
                      roi > 50 ? 'POSITIVE ROI - Prioritized remediation' :
                      'NEGATIVE ROI - Schedule remediation'
    };
  }

  /**
   * Aggregate risk for multiple vulnerabilities
   */
  calculateAggregateRisk(vulnerabilities, context = {}) {
    const risks = vulnerabilities.map(v => this.calculateBusinessRisk(v, context));

    // Aggregate scores using probability accumulation
    const totalRisk = 1 - risks.reduce((acc, r) => {
      const probabilityOfNoIncident = 1 - (r.score / 100);
      return acc * probabilityOfNoIncident;
    }, 1);

    // Sum of individual risks (simplified)
    const sumRisk = risks.reduce((acc, r) => acc + r.score, 0);

    // Count by rating
    const byRating = {};
    for (const r of risks) {
      byRating[r.rating] = (byRating[r.rating] || 0) + 1;
    }

    return {
      aggregateRiskScore: (totalRisk * 100).toFixed(1),
      aggregateRiskRating: this.getRiskRating(totalRisk * 100),
      sumRiskScore: sumRisk.toFixed(1),
      vulnerabilitiesCount: vulnerabilities.length,
      byRating,
      topRisks: risks.sort((a, b) => b.score - a.score).slice(0, 5)
    };
  }
}

export function createRiskCalculator(config = {}) {
  return new RiskCalculator(config);
}

export default RiskCalculator;