import { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { ShareGallery } from '@/components/share/ShareGallery';
import { notFound } from 'next/navigation';

interface Props {
    params: Promise<{ id: string }>;
}

// Get session data for metadata
async function getSessionData(id: string) {
    const { data: session, error } = await supabase
        .from('sessions')
        .select(`
            *,
            frames:frame_id (name, image_url),
            booths:booth_id (name, location)
        `)
        .eq('id', id)
        .single();

    if (error || !session) {
        return null;
    }

    return session;
}

// Dynamic metadata for sharing
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    const session = await getSessionData(id);

    if (!session) {
        return {
            title: 'Photo Not Found | ChronoSnap',
        };
    }

    const boothName = session.booths?.name || 'ChronoSnap';

    return {
        title: `${boothName} | ChronoSnap`,
        description: `View and download photos from ${boothName}`,
        openGraph: {
            title: `${boothName} Photos`,
            description: `View and download your photobooth pictures`,
            images: session.final_image_url ? [session.final_image_url] : [],
        },
    };
}

export default async function SharePage({ params }: Props) {
    const { id } = await params;
    const session = await getSessionData(id);

    if (!session || session.status !== 'completed') {
        notFound();
    }

    // Combine photos - final image + individual photos
    const allPhotos: string[] = [];

    if (session.final_image_url) {
        allPhotos.push(session.final_image_url);
    }

    if (session.photos_urls && Array.isArray(session.photos_urls)) {
        allPhotos.push(...session.photos_urls);
    }

    const boothName = session.booths?.name || 'ChronoSnap';
    const frameName = session.frames?.name || 'Photo';
    const videoUrl = session.video_url || null;

    return (
        <ShareGallery
            sessionId={id}
            eventName={boothName}
            frameName={frameName}
            photos={allPhotos}
            videoUrl={videoUrl}
            createdAt={session.created_at}
        />
    );
}

