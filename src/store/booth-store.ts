import { create } from 'zustand';
import { Frame, Session, Payment } from '@/lib/supabase';

export type BoothStep =
    | 'idle'
    | 'voucher'
    | 'select-frame'
    | 'payment'
    | 'countdown'
    | 'capturing'
    | 'review'
    | 'print'
    | 'complete';

interface CapturedPhoto {
    index: number;
    dataUrl: string;
    url?: string;
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
    session: Session | null;
    setSession: (session: Session | null) => void;

    // Payment information
    payment: Payment | null;
    setPayment: (payment: Payment | null) => void;

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

    // Captured photos
    capturedPhotos: CapturedPhoto[];
    addCapturedPhoto: (photo: CapturedPhoto) => void;
    clearCapturedPhotos: () => void;

    // Final composited image
    finalImage: string | null;
    setFinalImage: (image: string | null) => void;

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

    capturedPhotos: [],
    addCapturedPhoto: (photo) => set((state) => ({
        capturedPhotos: [...state.capturedPhotos, photo],
    })),
    clearCapturedPhotos: () => set({ capturedPhotos: [] }),

    finalImage: null,
    setFinalImage: (image) => set({ finalImage: image }),

    isLoading: false,
    setIsLoading: (loading) => set({ isLoading: loading }),

    error: null,
    setError: (error) => set({ error }),

    appliedVoucher: null,
    setAppliedVoucher: (voucher) => set({ appliedVoucher: voucher }),

    resetSession: () => set({
        step: 'idle',
        selectedFrame: null,
        session: null,
        payment: null,
        qrCodeData: null,
        invoiceUrl: null,
        countdownValue: 3,
        currentPhotoIndex: 0,
        capturedPhotos: [],
        finalImage: null,
        isLoading: false,
        error: null,
        appliedVoucher: null,
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
    selectedCameraId: string | null;
    setSelectedCameraId: (id: string | null) => void;
    cameraTestStatus: 'idle' | 'testing' | 'success' | 'error';
    setCameraTestStatus: (status: 'idle' | 'testing' | 'success' | 'error') => void;
    cameraError: string | null;
    setCameraError: (error: string | null) => void;
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

    // Camera settings
    selectedCameraId: null,
    setSelectedCameraId: (id) => set({ selectedCameraId: id }),
    cameraTestStatus: 'idle',
    setCameraTestStatus: (status) => set({ cameraTestStatus: status }),
    cameraError: null,
    setCameraError: (error) => set({ cameraError: error }),
}));
