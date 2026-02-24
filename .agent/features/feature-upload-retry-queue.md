# Upload Retry Queue

## Problem
When uploads fail due to network issues (offline, timeout, weak Wi-Fi at events), the session photos are lost. The user gets a QR code error and their photos are gone forever. This is unacceptable for a paid service.

## Goal
Implement a persistent local queue that stores failed uploads and automatically retries them when connectivity returns, ensuring **zero photo loss** even in unstable network conditions.

## Design (Senior Engineering Perspective)

### Architecture

```
Upload attempt → Success? → Done
                  ↓ Fail
              Save to IndexedDB queue
                  ↓
              Background retry loop (every 30s when online)
                  ↓
              Success? → Remove from queue, update session
                  ↓ Fail
              Increment retry count, exponential backoff
```

### Queue Item Schema
```typescript
interface UploadQueueItem {
    id: string;                    // Unique ID (uuid)
    sessionId: string;             // Related session
    type: 'strip' | 'photo' | 'gif';
    photoIndex?: number;           // For individual photos
    dataUrl: string;               // Base64 image data
    createdAt: number;             // Timestamp
    retryCount: number;            // Number of attempts
    lastError?: string;            // Last error message
    status: 'pending' | 'uploading' | 'failed';
}
```

### Retry Strategy
- **Initial retry**: 30 seconds after failure
- **Exponential backoff**: 30s → 60s → 120s → 300s (max 5 min)
- **Max retries**: 10 attempts (then mark as permanently failed)
- **Trigger**: Online event + periodic interval
- **Batch size**: Process 1 upload at a time to avoid overwhelming the connection

### Storage
- Use **IndexedDB** (same pattern as frame-cache.ts) — `chronosnap-upload-queue` database
- Store the full base64 data URL so uploads can be retried without the original photos

### UI Indicators
- Small badge on the status indicator showing queued upload count
- Toast notification when queued uploads succeed: "3 photos synced"
- In admin panel: show queue status and allow manual retry/clear

## Implementation

### Files to Create
- `src/lib/upload-queue.ts` — IndexedDB queue CRUD + retry logic
- `src/hooks/useUploadQueue.ts` — React hook for queue state + background processing

### Files to Modify
- `src/hooks/useUploadSession.ts` — Wrap upload calls with queue fallback
- `src/components/booth/BoothStatusIndicator.tsx` — Show queue count badge
- `src/hooks/useBoothHealth.ts` — Trigger queue processing on reconnect

### Core Functions
```typescript
// upload-queue.ts
export async function enqueueUpload(item: Omit<UploadQueueItem, 'id' | 'retryCount' | 'status'>): Promise<void>
export async function getQueuedUploads(): Promise<UploadQueueItem[]>
export async function processQueue(): Promise<void>
export async function removeFromQueue(id: string): Promise<void>
export async function getQueueCount(): Promise<number>
```

### Integration with useUploadSession
```typescript
// In uploadAndGenerateQR:
try {
    finalUrl = await uploadFinalImageClient(sessionId, stripBlob);
} catch (err) {
    // Instead of throwing, queue for retry
    await enqueueUpload({
        sessionId,
        type: 'strip',
        dataUrl: imageDataUrl,
        createdAt: Date.now(),
    });
    // Continue with other uploads — don't block the user
}
```

### Background Processing Hook
```typescript
// useUploadQueue.ts
export function useUploadQueue() {
    const { isOnline } = useBoothHealth();
    const [queueCount, setQueueCount] = useState(0);

    useEffect(() => {
        if (!isOnline) return;
        // Process queue when coming back online
        processQueue().then(updateCount);
    }, [isOnline]);

    useEffect(() => {
        // Periodic retry every 30s
        const interval = setInterval(() => {
            if (navigator.onLine) processQueue().then(updateCount);
        }, 30000);
        return () => clearInterval(interval);
    }, []);
}
```
