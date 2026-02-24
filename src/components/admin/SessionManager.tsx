'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Plus,
    Check,
    Copy,
    Trash2,
    Pencil,
    Camera,
    Loader2,
    FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { BoothSession } from '@/lib/supabase';

interface BoothSessionWithMeta extends BoothSession {
    photo_count: number;
    booth_session_frames?: { frame_id: string }[];
}

const DEFAULT_SESSION: Partial<BoothSession> = {
    price: 15000,
    countdown_seconds: 3,
    preview_seconds: 3,
    review_timeout_seconds: 60,
    print_copies: 1,
    default_filter: 'none',
    payment_bypass: false,
    event_mode: false,
    slideshow_enabled: false,
};

export function SessionManager() {
    const booth = useTenantStore((s) => s.booth);
    const { setActiveSession } = useSessionProfileStore();

    const [sessions, setSessions] = useState<BoothSessionWithMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [editingSession, setEditingSession] = useState<Partial<BoothSession> | null>(null);
    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [activating, setActivating] = useState<string | null>(null);

    const fetchSessions = useCallback(async () => {
        if (!booth?.id) return;
        setLoading(true);
        try {
            const res = await apiFetch(`/api/booth-sessions?boothId=${booth.id}`);
            const json = await res.json();
            if (json.data) setSessions(json.data);
        } catch (err) {
            console.error('Failed to fetch sessions:', err);
        } finally {
            setLoading(false);
        }
    }, [booth?.id]);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    function openCreate() {
        setEditingSession({ ...DEFAULT_SESSION, name: '' });
        setEditDialogOpen(true);
    }

    function openEdit(session: BoothSessionWithMeta) {
        setEditingSession({ ...session });
        setEditDialogOpen(true);
    }

    async function handleSave() {
        if (!editingSession?.name?.trim()) {
            toast.error('Session name is required');
            return;
        }
        if (!booth?.id) return;

        setSaving(true);
        try {
            const isNew = !editingSession.id;
            const url = isNew
                ? '/api/booth-sessions'
                : `/api/booth-sessions/${editingSession.id}`;
            const method = isNew ? 'POST' : 'PATCH';

            const body = isNew
                ? { ...editingSession, boothId: booth.id }
                : editingSession;

            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to save');
            }

            const result = await res.json();

            // If we just edited the currently active session, update the store
            if (!isNew && result.data) {
                const activeSession = useSessionProfileStore.getState().activeSession;
                if (activeSession?.id === editingSession.id) {
                    setActiveSession({ ...activeSession, ...result.data });
                }
            }

            toast.success(isNew ? 'Session created' : 'Session updated');
            setEditDialogOpen(false);
            setEditingSession(null);
            fetchSessions();
        } catch (err: any) {
            toast.error(err.message || 'Failed to save session');
        } finally {
            setSaving(false);
        }
    }

    async function handleActivate(sessionId: string) {
        setActivating(sessionId);
        try {
            const res = await apiFetch(`/api/booth-sessions/${sessionId}/activate`, {
                method: 'PUT',
            });
            if (!res.ok) throw new Error('Failed to activate');

            const json = await res.json();
            setActiveSession(json.data);
            toast.success(`Switched to "${json.data.name}"`);
            fetchSessions();
        } catch (err: any) {
            toast.error(err.message || 'Failed to activate session');
        } finally {
            setActivating(null);
        }
    }

    async function handleDuplicate(sessionId: string) {
        try {
            const res = await apiFetch(`/api/booth-sessions/${sessionId}/duplicate`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error('Failed to duplicate');
            toast.success('Session duplicated');
            fetchSessions();
        } catch (err: any) {
            toast.error(err.message || 'Failed to duplicate session');
        }
    }

    async function handleDelete() {
        if (!deletingSessionId) return;
        try {
            const res = await apiFetch(`/api/booth-sessions/${deletingSessionId}`, {
                method: 'DELETE',
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to delete');
            }
            toast.success('Session deleted');
            setDeleteDialogOpen(false);
            setDeletingSessionId(null);
            fetchSessions();
        } catch (err: any) {
            toast.error(err.message || 'Failed to delete');
        }
    }

    if (!booth) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No booth configured</p>
            </div>
        );
    }

    return (
        <>
            <Card className="border">
                <CardHeader>
                    <div>
                        <CardTitle>Sessions</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                            Manage booth configuration profiles
                        </p>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
                            <p>No sessions yet</p>
                            <p className="text-sm mt-1">Create your first session from the top bar</p>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {sessions.map((session) => (
                                <div
                                    key={session.id}
                                    className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${session.is_active
                                        ? 'border-primary/50 bg-primary/5'
                                        : 'border-border hover:bg-muted/50'
                                        }`}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        {session.is_active && (
                                            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
                                        )}
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-medium truncate">
                                                    {session.name}
                                                </p>
                                                {session.is_active && (
                                                    <Badge variant="outline" className="text-xs shrink-0 border-green-500 text-green-600">
                                                        Active
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                                <span className="flex items-center gap-1">
                                                    <Camera className="w-3 h-3" />
                                                    {session.photo_count} photos
                                                </span>
                                                <span>
                                                    Rp {(session.price || 0).toLocaleString('id-ID')}
                                                </span>
                                                {session.payment_bypass && (
                                                    <Badge variant="secondary" className="text-[10px] h-4">Free</Badge>
                                                )}
                                                {session.event_mode && (
                                                    <Badge variant="secondary" className="text-[10px] h-4">Event</Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        {!session.is_active && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleActivate(session.id)}
                                                disabled={activating === session.id}
                                                className="gap-1 text-green-600 hover:text-green-700"
                                            >
                                                {activating === session.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Check className="w-3.5 h-3.5" />
                                                )}
                                                Activate
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => openEdit(session)}
                                            className="h-8 w-8"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDuplicate(session.id)}
                                            className="h-8 w-8"
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </Button>
                                        {!session.is_active && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setDeletingSessionId(session.id);
                                                    setDeleteDialogOpen(true);
                                                }}
                                                className="h-8 w-8 text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Edit Dialog — full settings (only for existing sessions) */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingSession?.id ? 'Edit Session' : 'New Session'}
                        </DialogTitle>
                    </DialogHeader>

                    {editingSession && (
                        <div className="space-y-6">
                            {/* Name — always shown */}
                            <div className="space-y-2">
                                <Label>Session Name *</Label>
                                <Input
                                    value={editingSession.name || ''}
                                    onChange={(e) =>
                                        setEditingSession({ ...editingSession, name: e.target.value })
                                    }
                                    placeholder="e.g., Wedding Sarah & Tom"
                                />
                            </div>

                            {/* Event Mode — always shown */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-medium">Event Mode</h4>
                                    <Switch
                                        checked={editingSession.event_mode || false}
                                        onCheckedChange={(v) =>
                                            setEditingSession({ ...editingSession, event_mode: v })
                                        }
                                    />
                                </div>
                                {editingSession.event_mode && (
                                    <div className="space-y-3 pl-1">
                                        <div className="space-y-2">
                                            <Label>Event name</Label>
                                            <Input
                                                value={editingSession.event_name || ''}
                                                onChange={(e) =>
                                                    setEditingSession({ ...editingSession, event_name: e.target.value })
                                                }
                                                placeholder="Sarah & Tom's Wedding"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Event date</Label>
                                            <Input
                                                type="date"
                                                value={editingSession.event_date || ''}
                                                onChange={(e) =>
                                                    setEditingSession({ ...editingSession, event_date: e.target.value })
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Hashtag</Label>
                                            <Input
                                                value={editingSession.event_hashtag || ''}
                                                onChange={(e) =>
                                                    setEditingSession({ ...editingSession, event_hashtag: e.target.value })
                                                }
                                                placeholder="#SarahAndTom2026"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Message</Label>
                                            <Input
                                                value={editingSession.event_message || ''}
                                                onChange={(e) =>
                                                    setEditingSession({ ...editingSession, event_message: e.target.value })
                                                }
                                                placeholder="Thank you for celebrating with us!"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Remaining fields only shown when editing an existing session */}
                            {editingSession.id && (
                                <>
                                    <Separator />

                                    {/* Pricing & Timing */}
                                    <div>
                                        <h4 className="text-sm font-medium mb-3">Pricing & Timing</h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Price (IDR)</Label>
                                                <Input
                                                    type="number"
                                                    value={editingSession.price ?? 15000}
                                                    onChange={(e) =>
                                                        setEditingSession({
                                                            ...editingSession,
                                                            price: parseInt(e.target.value) || 0,
                                                        })
                                                    }
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Countdown (sec)</Label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={10}
                                                    value={editingSession.countdown_seconds ?? 3}
                                                    onChange={(e) =>
                                                        setEditingSession({
                                                            ...editingSession,
                                                            countdown_seconds: parseInt(e.target.value) || 3,
                                                        })
                                                    }
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Preview (sec)</Label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={15}
                                                    value={editingSession.preview_seconds ?? 3}
                                                    onChange={(e) =>
                                                        setEditingSession({
                                                            ...editingSession,
                                                            preview_seconds: parseInt(e.target.value) || 3,
                                                        })
                                                    }
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Review timeout (sec)</Label>
                                                <Input
                                                    type="number"
                                                    min={10}
                                                    max={300}
                                                    value={editingSession.review_timeout_seconds ?? 60}
                                                    onChange={(e) =>
                                                        setEditingSession({
                                                            ...editingSession,
                                                            review_timeout_seconds: parseInt(e.target.value) || 60,
                                                        })
                                                    }
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Print copies</Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    max={10}
                                                    value={editingSession.print_copies ?? 1}
                                                    onChange={(e) =>
                                                        setEditingSession({
                                                            ...editingSession,
                                                            print_copies: parseInt(e.target.value) || 1,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Toggles */}
                                    <div>
                                        <h4 className="text-sm font-medium mb-3">Options</h4>
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <Label>Payment bypass (free)</Label>
                                                <Switch
                                                    checked={editingSession.payment_bypass || false}
                                                    onCheckedChange={(v) =>
                                                        setEditingSession({ ...editingSession, payment_bypass: v })
                                                    }
                                                />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <Label>Slideshow on idle</Label>
                                                <Switch
                                                    checked={editingSession.slideshow_enabled || false}
                                                    onCheckedChange={(v) =>
                                                        setEditingSession({ ...editingSession, slideshow_enabled: v })
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <Separator />

                                    {/* Branding */}
                                    <div>
                                        <h4 className="text-sm font-medium mb-3">Branding</h4>
                                        <div className="space-y-3">
                                            <div className="space-y-2">
                                                <Label>Title</Label>
                                                <Input
                                                    value={editingSession.brand_title || ''}
                                                    onChange={(e) =>
                                                        setEditingSession({ ...editingSession, brand_title: e.target.value })
                                                    }
                                                    placeholder="ChronoSnap"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Subtitle</Label>
                                                <Input
                                                    value={editingSession.brand_subtitle || ''}
                                                    onChange={(e) =>
                                                        setEditingSession({ ...editingSession, brand_subtitle: e.target.value })
                                                    }
                                                    placeholder="Capture the moment"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-2">
                                                    <Label>Primary color</Label>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            type="color"
                                                            value={editingSession.brand_primary_color || '#000000'}
                                                            onChange={(e) =>
                                                                setEditingSession({
                                                                    ...editingSession,
                                                                    brand_primary_color: e.target.value,
                                                                })
                                                            }
                                                            className="w-10 h-9 p-1 cursor-pointer"
                                                        />
                                                        <Input
                                                            value={editingSession.brand_primary_color || ''}
                                                            onChange={(e) =>
                                                                setEditingSession({
                                                                    ...editingSession,
                                                                    brand_primary_color: e.target.value,
                                                                })
                                                            }
                                                            placeholder="#000000"
                                                            className="flex-1"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Accent color</Label>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            type="color"
                                                            value={editingSession.brand_accent_color || '#000000'}
                                                            onChange={(e) =>
                                                                setEditingSession({
                                                                    ...editingSession,
                                                                    brand_accent_color: e.target.value,
                                                                })
                                                            }
                                                            className="w-10 h-9 p-1 cursor-pointer"
                                                        />
                                                        <Input
                                                            value={editingSession.brand_accent_color || ''}
                                                            onChange={(e) =>
                                                                setEditingSession({
                                                                    ...editingSession,
                                                                    brand_accent_color: e.target.value,
                                                                })
                                                            }
                                                            placeholder="#000000"
                                                            className="flex-1"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Background color</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        type="color"
                                                        value={editingSession.background_color || '#ffffff'}
                                                        onChange={(e) =>
                                                            setEditingSession({
                                                                ...editingSession,
                                                                background_color: e.target.value,
                                                            })
                                                        }
                                                        className="w-10 h-9 p-1 cursor-pointer"
                                                    />
                                                    <Input
                                                        value={editingSession.background_color || ''}
                                                        onChange={(e) =>
                                                            setEditingSession({
                                                                ...editingSession,
                                                                background_color: e.target.value,
                                                            })
                                                        }
                                                        placeholder="#ffffff"
                                                        className="flex-1"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setEditDialogOpen(false)}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {editingSession?.id ? 'Save Changes' : 'Create Session'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete session?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete this session profile and unlink any photos.
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
