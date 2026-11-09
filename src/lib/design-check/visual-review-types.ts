export const VISUAL_AREAS = ['hierarchy', 'typography_readability', 'colour_contrast', 'spacing_alignment', 'mobile_contact'] as const;
export type VisualArea = typeof VISUAL_AREAS[number];
export type CaptureId = 'desktop' | 'mobile';
export interface VisualCapture { id: CaptureId; available: boolean; reason?: 'capture_unavailable' | 'image_too_large' | 'image_invalid' | 'payload_limit'; mimeType?: 'image/png' | 'image/jpeg'; base64?: string; width?: number; height?: number; totalHeight?: number | null }
export interface VisualFinding { id: string; captureId: CaptureId; area: VisualArea; section: string; element: string; visibleText?: string; observation: string; consequence: string; change: string; priority: 'high' | 'medium'; limitation: string }
export interface VisualStrength { captureId: CaptureId; area: VisualArea; section: string; element: string; visibleText?: string; observation: string }
export interface ViewportReview { captureId: CaptureId; pageKind: 'homepage' | 'challenge' | 'error' | 'login' | 'unreadable' | 'uncertain'; areas: Record<VisualArea, 'assessed' | 'not_assessable'>; areaReasons: Partial<Record<VisualArea, string>> }
export interface VisualReview { version: 1; status: 'complete' | 'partial' | 'unavailable'; reasonCodes: Array<'vision_unavailable' | 'invalid_visual_response' | 'capture_unavailable' | 'capture_clipped' | 'unsuitable_page' | 'payload_limit' | 'contrast_unverified' | 'uncertain_observation'>; captures: VisualCapture[]; viewportReviews: ViewportReview[]; findings: VisualFinding[]; strengths: VisualStrength[] }
