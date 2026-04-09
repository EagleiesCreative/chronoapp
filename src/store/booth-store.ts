import { create } from 'zustand';
import { Frame, Session, Payment } from '@/lib/supabase';

export type SessionInit = Pick<Session, 'id'> & Partial<Omit<Session, 'id'>>;
export type PaymentInit = Pick<Payment, 'id'> & Partial<Omit<Payment, 'id'>>;

export type BoothStep =
    | 'idle'
    | 'voucher'
    | 'select-frame'
    | 'payment'
    | 'countdown'
    | 'capturing'
    | 'filter'
    | 'final-review'
    | 'review'
    | 'print'
    | 'complete';

interface CapturedPhoto {
    index: number;
    dataUrl: string;
    url?: string;
    videoBlob?: Blob;
    videoUrl?: string;
}

interface BoothState {
    // Current step in the flow
    step: BoothStep;
    setStep: (step: BoothStep) => void;

    // Available frames
    frames: Frame[];
    setFrames: (frames: Frame[]) => void;

    // Selected frame for the session
    selectedFrame: Frame | null;
    setSelectedFrame: (frame: Frame | null) => void;

    // Current session
    session: Session | SessionInit | null;
    setSession: (session: Session | SessionInit | null) => void;

    // Payment information
    payment: Payment | PaymentInit | null;
    setPayment: (payment: Payment | PaymentInit | null) => void;

    // QR code data for payment
    qrCodeData: string | null;
    setQrCodeData: (data: string | null) => void;

    // Invoice URL (alternative to QR)
    invoiceUrl: string | null;
    setInvoiceUrl: (url: string | null) => void;

    // Countdown state
    countdownValue: number;
    setCountdownValue: (value: number) => void;

    // Current photo being captured
    currentPhotoIndex: number;
    setCurrentPhotoIndex: (index: number) => void;

    // Retake state for partial retake across screens
    pendingRetakeIndex: number | null;
    setPendingRetakeIndex: (index: number | null) => void;
    retakeReturnStep: BoothStep | null;
    setRetakeReturnStep: (step: BoothStep | null) => void;

    // Captured photos
    capturedPhotos: CapturedPhoto[];
    addCapturedPhoto: (photo: CapturedPhoto) => void;
    replaceCapturedPhoto: (index: number, photo: CapturedPhoto) => void;
    clearCapturedPhotos: () => void;

    // Final composited image
    finalImage: string | null;
    setFinalImage: (image: string | null) => void;

    // Final composited video
    finalVideoUrl: string | null;
    setFinalVideoUrl: (url: string | null) => void;
    finalVideoBlob: Blob | null;
    setFinalVideoBlob: (blob: Blob | null) => void;

    // Print-ready image (always 4R size — 2R frames duplicated side-by-side)
    printImage: string | null;
    setPrintImage: (image: string | null) => void;

    // Loading states
    isLoading: boolean;
    setIsLoading: (loading: boolean) => void;

    // Error handling
    error: string | null;
    setError: (error: string | null) => void;

    // Voucher state
    appliedVoucher: {
        code: string;
        discount_amount: number;
        discount_type: string;
        original_price: number;
        discount_value: number;
        final_price: number;
    } | null;
    setAppliedVoucher: (voucher: BoothState['appliedVoucher']) => void;

    // Selected photo filter
    selectedFilter: string;
    setSelectedFilter: (filter: string) => void;

    // Reset everything for a new session
    resetSession: () => void;
}

export const useBoothStore = create<BoothState>((set) => ({
    step: 'idle',
    setStep: (step) => set({ step }),

    frames: [],
    setFrames: (frames) => set({ frames }),

    selectedFrame: null,
    setSelectedFrame: (frame) => set({ selectedFrame: frame }),

    session: null,
    setSession: (session) => set({ session }),

    payment: null,
    setPayment: (payment) => set({ payment }),

    qrCodeData: null,
    setQrCodeData: (data) => set({ qrCodeData: data }),

    invoiceUrl: null,
    setInvoiceUrl: (url) => set({ invoiceUrl: url }),

    countdownValue: 3,
    setCountdownValue: (value) => set({ countdownValue: value }),

    currentPhotoIndex: 0,
    setCurrentPhotoIndex: (index) => set({ currentPhotoIndex: index }),

    pendingRetakeIndex: null,
    setPendingRetakeIndex: (index) => set({ pendingRetakeIndex: index }),

    retakeReturnStep: null,
    setRetakeReturnStep: (step) => set({ retakeReturnStep: step }),

    capturedPhotos: [],
    addCapturedPhoto: (photo) => set((state) => ({
        capturedPhotos: [...state.capturedPhotos, photo],
    })),
    replaceCapturedPhoto: (index, photo) => set((state) => {
        const updated = [...state.capturedPhotos];
        updated[index] = photo;
        return { capturedPhotos: updated };
    }),
    clearCapturedPhotos: () => set({ capturedPhotos: [] }),

    finalImage: null,
    setFinalImage: (image) => set({ finalImage: image }),

    finalVideoUrl: null,
    setFinalVideoUrl: (url) => set({ finalVideoUrl: url }),

    finalVideoBlob: null,
    setFinalVideoBlob: (blob) => set({ finalVideoBlob: blob }),

    printImage: null,
    setPrintImage: (image) => set({ printImage: image }),

    isLoading: false,
    setIsLoading: (loading) => set({ isLoading: loading }),

    error: null,
    setError: (error) => set({ error }),

    appliedVoucher: null,
    setAppliedVoucher: (voucher) => set({ appliedVoucher: voucher }),

    selectedFilter: 'none',
    setSelectedFilter: (filter) => set({ selectedFilter: filter }),

    resetSession: () => set({
        step: 'idle',
        selectedFrame: null,
        session: null,
        payment: null,
        qrCodeData: null,
        invoiceUrl: null,
        countdownValue: 3,
        currentPhotoIndex: 0,
        pendingRetakeIndex: null,
        retakeReturnStep: null,
        capturedPhotos: [],
        finalImage: null,
        finalVideoUrl: null,
        finalVideoBlob: null,
        printImage: null,
        isLoading: false,
        error: null,
        appliedVoucher: null,
        selectedFilter: 'none',
    }),
}));

// Admin store for configuration
interface AdminState {
    isAuthenticated: boolean;
    setAuthenticated: (auth: boolean) => void;

    // Frame being edited
    editingFrame: Frame | null;
    setEditingFrame: (frame: Frame | null) => void;

    // Settings
    defaultPrice: number;
    setDefaultPrice: (price: number) => void;

    // Admin panel visibility
    showAdminPanel: boolean;
    setShowAdminPanel: (show: boolean) => void;

    // Camera settings
    // selectedCameraId: Tauri numeric index (e.g. "0", "1") used for native camera commands
    selectedCameraId: string | null;
    setSelectedCameraId: (id: string | null) => void;
    // browserCameraId: browser WebAPI deviceId UUID used for react-webcam / getUserMedia
    browserCameraId: string | null;
    setBrowserCameraId: (id: string | null) => void;
    cameraTestStatus: 'idle' | 'testing' | 'success' | 'error';
    setCameraTestStatus: (status: 'idle' | 'testing' | 'success' | 'error') => void;
    cameraError: string | null;
    setCameraError: (error: string | null) => void;
    // Camera mirroring
    isCameraMirrored: boolean;
    setCameraMirrored: (mirrored: boolean) => void;

    // Camera type detection (auto-set based on selected camera name)
    cameraType: 'system' | 'canon' | 'sony';
    setCameraType: (type: 'system' | 'canon' | 'sony') => void;

    // Live Video Feature Toggle
    isVideoMode: boolean;
    setIsVideoMode: (videoMode: boolean) => void;

    // Idle live preview background toggle
    isLivePreviewEnabled: boolean;
    setIsLivePreviewEnabled: (enabled: boolean) => void;
}

const CAMERA_STORAGE_KEY = 'chronosnap_selected_camera';
const BROWSER_CAMERA_STORAGE_KEY = 'chronosnap_browser_camera';
const MIRROR_CAMERA_STORAGE_KEY = 'chronosnap_mirror_camera';
const VIDEO_MODE_STORAGE_KEY = 'chronosnap_video_mode';
const CAMERA_TYPE_STORAGE_KEY = 'chronosnap_camera_type';
const LIVE_PREVIEW_STORAGE_KEY = 'chronosnap_live_preview_enabled';

function getPersistedValue(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function setPersistedValue(key: string, value: string | null): void {
    if (typeof window === 'undefined') return;
    try {
        if (value) {
            localStorage.setItem(key, value);
        } else {
            localStorage.removeItem(key);
        }
    } catch { /* ignore storage errors */ }
}

export const useAdminStore = create<AdminState>((set) => ({
    isAuthenticated: false,
    setAuthenticated: (auth) => set({ isAuthenticated: auth }),

    editingFrame: null,
    setEditingFrame: (frame) => set({ editingFrame: frame }),

    defaultPrice: 15000,
    setDefaultPrice: (price) => set({ defaultPrice: price }),

    showAdminPanel: false,
    setShowAdminPanel: (show) => set({ showAdminPanel: show }),

    // Tauri numeric index — persisted to localStorage
    selectedCameraId: getPersistedValue(CAMERA_STORAGE_KEY),
    setSelectedCameraId: (id) => {
        setPersistedValue(CAMERA_STORAGE_KEY, id);
        set({ selectedCameraId: id });
    },

    // Browser WebAPI deviceId UUID — persisted to localStorage
    browserCameraId: getPersistedValue(BROWSER_CAMERA_STORAGE_KEY),
    setBrowserCameraId: (id) => {
        setPersistedValue(BROWSER_CAMERA_STORAGE_KEY, id);
        set({ browserCameraId: id });
    },

    cameraTestStatus: 'idle',
    setCameraTestStatus: (status) => set({ cameraTestStatus: status }),
    cameraError: null,
    setCameraError: (error) => set({ cameraError: error }),
    
    isCameraMirrored: getPersistedValue(MIRROR_CAMERA_STORAGE_KEY) !== 'false', // Default to true
    setCameraMirrored: (mirrored) => {
        setPersistedValue(MIRROR_CAMERA_STORAGE_KEY, mirrored ? 'true' : 'false');
        set({ isCameraMirrored: mirrored });
    },

    cameraType: (getPersistedValue(CAMERA_TYPE_STORAGE_KEY) as 'system' | 'canon' | 'sony') || 'system',
    setCameraType: (type) => {
        setPersistedValue(CAMERA_TYPE_STORAGE_KEY, type);
        set({ cameraType: type });
    },

    isVideoMode: getPersistedValue(VIDEO_MODE_STORAGE_KEY) !== 'false', // Default to true!
    setIsVideoMode: (videoMode) => {
        setPersistedValue(VIDEO_MODE_STORAGE_KEY, videoMode ? 'true' : 'false');
        set({ isVideoMode: videoMode });
    },

    isLivePreviewEnabled: getPersistedValue(LIVE_PREVIEW_STORAGE_KEY) !== 'false',
    setIsLivePreviewEnabled: (enabled) => {
        setPersistedValue(LIVE_PREVIEW_STORAGE_KEY, enabled ? 'true' : 'false');
        set({ isLivePreviewEnabled: enabled });
    },
}));
