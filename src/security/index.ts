// Copyright 2026 Colin Byron. Apache-2.0 license.

export { Sanitizer } from './sanitizer';
export { ThreatClassifier } from './threat-classifier';
export { TrustResolver } from './trust';
export { OutputValidator, type ValidationResult, type ValidationIssue } from './validator';
export {
    INJECTION_PATTERNS,
    INVISIBLE_CHAR_PATTERNS,
    HTML_COMMENT_PATTERN,
    BASE64_PAYLOAD_PATTERN,
    CODE_OUTPUT_DANGER_PATTERNS,
} from './patterns';
export {
    type ThreatAssessment,
    type ThreatClassification,
    type ThreatType,
    type TrustTier,
    type UserTrustProfile,
    type ThreatThresholds,
    type SanitizationResult,
    type AuditEntry,
    type AuditAction,
    BASE_TRUST_SCORES,
    computeThresholds,
} from './types';
