import { Suspense } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Metadata } from 'next';

async function getEventData(boothId: string) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get booth info
    const { data: booth } = await supabase
        .from('booths')
        .select('id, name, event_name, event_date, event_hashtag, event_message, brand_logo_url, brand_primary_color')
        .eq('id', boothId)
        .single();

    if (!booth) return null;

    // Get all completed sessions for this booth
    const { data: sessions } = await supabase
        .from('sessions')
        .select('id, final_image_url, photos_urls, created_at')
        .eq('booth_id', boothId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(200);

    return { booth, sessions: sessions || [] };
}

export async function generateMetadata({ params }: { params: Promise<{ boothId: string }> }): Promise<Metadata> {
    const { boothId } = await params;
    const data = await getEventData(boothId);
    return {
        title: data?.booth?.event_name || 'Event Gallery — ChronoSnap',
        description: data?.booth?.event_message || 'Browse all photos from this event',
    };
}

export default async function EventGalleryPage({ params }: { params: Promise<{ boothId: string }> }) {
    const { boothId } = await params;
    const data = await getEventData(boothId);

    if (!data) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h1 className="text-2xl font-light text-gray-800 mb-2">Event Not Found</h1>
                    <p className="text-gray-500">This event gallery is not available.</p>
                </div>
            </div>
        );
    }

    const { booth, sessions } = data;
    const primaryColor = booth.brand_primary_color || '#8B7355';

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 py-6 text-center">
                    {booth.brand_logo_url && (
                        <img src={booth.brand_logo_url} alt="Logo" className="h-12 w-auto mx-auto mb-3 object-contain" />
                    )}
                    <h1 className="text-3xl font-light tracking-tight text-gray-900">
                        {booth.event_name || booth.name}
                    </h1>
                    {booth.event_hashtag && (
                        <p className="text-lg font-medium mt-1" style={{ color: primaryColor }}>
                            {booth.event_hashtag}
                        </p>
                    )}
                    {booth.event_date && (
                        <p className="text-sm text-gray-500 mt-1">
                            {new Date(booth.event_date).toLocaleDateString('en-US', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                            })}
                        </p>
                    )}
                    {booth.event_message && (
                        <p className="text-gray-600 mt-2 max-w-md mx-auto">{booth.event_message}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-3">{sessions.length} photos</p>
                </div>
            </header>

            {/* Photo Grid */}
            <main className="max-w-6xl mx-auto px-4 py-8">
                {sessions.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-gray-500 text-lg">No photos yet — be the first!</p>
                    </div>
                ) : (
                    <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
                        {sessions.map((session) => (
                            <div key={session.id} className="break-inside-avoid">
                                {session.final_image_url && (
                                    <a
                                        href={session.final_image_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white"
                                    >
                                        <img
                                            src={session.final_image_url}
                                            alt="Photo strip"
                                            className="w-full h-auto"
                                            loading="lazy"
                                        />
                                        <div className="px-3 py-2">
                                            <p className="text-xs text-gray-400">
                                                {new Date(session.created_at).toLocaleTimeString('en-US', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </p>
                                        </div>
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="border-t border-gray-200 py-6 text-center">
                <p className="text-xs text-gray-400">Powered by ChronoSnap</p>
            </footer>
        </div>
    );
}
