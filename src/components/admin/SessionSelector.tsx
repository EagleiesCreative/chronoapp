'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { BoothSession } from '@/lib/supabase';

interface BoothSessionListItem extends BoothSession {
    photo_count: number;
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

export function SessionSelector() {
    const booth = useTenantStore((s) => s.booth);
    const { activeSession, setActiveSession } = useSessionProfileStore();

    const [sessions, setSessions] = useState<BoothSessionListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [newSession, setNewSession] = useState<Partial<BoothSession>>({ ...DEFAULT_SESSION, name: '' });
    const [saving, setSaving] = useState(false);
    const [activating, setActivating] = useState(false);

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

    async function handleCreate() {
        if (!newSession.name?.trim()) {
            toast.error('Session name is required');
            return;
        }
        if (!booth?.id) return;

        setSaving(true);
        try {
            const res = await apiFetch('/api/booth-sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...newSession, boothId: booth.id }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to create');
            }

            toast.success('Session created');
            setCreateDialogOpen(false);
            setNewSession({ ...DEFAULT_SESSION, name: '' });
            fetchSessions();
        } catch (err: any) {
            toast.error(err.message || 'Failed to create session');
        } finally {
            setSaving(false);
        }
    }

    async function handleActivate(sessionId: string) {
        setActivating(true);
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
            setActivating(false);
        }
    }

    if (!booth) return null;

    return (
        <>
            <div className="flex items-center gap-2">
                {/* Session dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 min-w-[140px] justify-between"
                            disabled={loading}
                        >
                            <span className="truncate max-w-[160px]">
                                {activeSession ? (
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                                        {activeSession.name}
                                    </span>
                                ) : (
                                    'No session'
                                )}
                            </span>
                            <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[220px] z-[150]">
                        {sessions.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                No sessions created
                            </div>
                        ) : (
                            sessions.map((session) => (
                                <DropdownMenuItem
                                    key={session.id}
                                    onClick={() => handleActivate(session.id)}
                                    disabled={activating || session.is_active}
                                    className="flex items-center gap-2 cursor-pointer"
                                >
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${session.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                                    <span className="truncate flex-1">{session.name}</span>
                                    {session.is_active && (
                                        <Badge variant="outline" className="text-[10px] h-4 border-green-500 text-green-600 shrink-0">
                                            Active
                                        </Badge>
                                    )}
                                    {session.event_mode && (
                                        <Badge variant="secondary" className="text-[10px] h-4 shrink-0">Event</Badge>
                                    )}
                                </DropdownMenuItem>
                            ))
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => setCreateDialogOpen(true)}
                            className="gap-2 cursor-pointer"
                        >
                            <Plus className="w-4 h-4" />
                            New Session
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* New Session button */}
                <Button
                    size="sm"
                    variant="default"
                    className="gap-1.5"
                    onClick={() => setCreateDialogOpen(true)}
                >
                    <Plus className="w-4 h-4" />
                    New
                </Button>
            </div>

            {/* Simplified Create Dialog — only name + event mode */}
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>New Session</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5">
                        {/* Name */}
                        <div className="space-y-2">
                            <Label>Session Name *</Label>
                            <Input
                                value={newSession.name || ''}
                                onChange={(e) =>
                                    setNewSession({ ...newSession, name: e.target.value })
                                }
                                placeholder="e.g., Wedding Sarah & Tom"
                                autoFocus
                            />
                        </div>

                        {/* Event Mode */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-medium">Event Mode</h4>
                                <Switch
                                    checked={newSession.event_mode || false}
                                    onCheckedChange={(v) =>
                                        setNewSession({ ...newSession, event_mode: v })
                                    }
                                />
                            </div>
                            {newSession.event_mode && (
                                <div className="space-y-3 pl-1">
                                    <div className="space-y-2">
                                        <Label>Event name</Label>
                                        <Input
                                            value={newSession.event_name || ''}
                                            onChange={(e) =>
                                                setNewSession({ ...newSession, event_name: e.target.value })
                                            }
                                            placeholder="Sarah & Tom's Wedding"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Event date</Label>
                                        <Input
                                            type="date"
                                            value={newSession.event_date || ''}
                                            onChange={(e) =>
                                                setNewSession({ ...newSession, event_date: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Hashtag</Label>
                                        <Input
                                            value={newSession.event_hashtag || ''}
                                            onChange={(e) =>
                                                setNewSession({ ...newSession, event_hashtag: e.target.value })
                                            }
                                            placeholder="#SarahAndTom2026"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Message</Label>
                                        <Input
                                            value={newSession.event_message || ''}
                                            onChange={(e) =>
                                                setNewSession({ ...newSession, event_message: e.target.value })
                                            }
                                            placeholder="Thank you for celebrating with us!"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setCreateDialogOpen(false)}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={saving}>
                            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Create Session
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
