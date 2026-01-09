# ChronoSnap - Premium Photo Booth Application

A high-end photobooth kiosk application built with Next.js, Tauri, Supabase, and Xendit.

## Features

- 📸 **Multi-photo Capture** - Take multiple photos with countdown animations
- 🖼️ **Custom Frames** - Upload PNG frames with transparency and define photo slot positions
- 💳 **QR Payment** - Integrated Xendit QRIS payment before sessions
- 🖨️ **Print Support** - Direct printing via Tauri native integration
- 📱 **Digital Download** - QR code for customers to download their photos
- 🎨 **Premium Design** - Glassmorphism, smooth animations, elegant aesthetics

## Tech Stack

- **Frontend**: Next.js 15, React 19, TailwindCSS, ShadcnUI
- **Native Wrapper**: Tauri v2
- **Database**: Supabase (PostgreSQL)
- **Payments**: Xendit API (QRIS)
- **State**: Zustand
- **Animations**: Framer Motion

## Setup

### 1. Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Xendit Configuration (Server-side only)
XENDIT_SECRET_KEY=your_xendit_secret_key
XENDIT_WEBHOOK_TOKEN=your_xendit_webhook_verification_token

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2. Supabase Setup

Run the following SQL in your Supabase SQL Editor:

```sql
-- Enable UUID extension
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Frames table
CREATE TABLE frames (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  image_url TEXT NOT NULL,
  photo_slots JSONB DEFAULT '[]',
  price INTEGER DEFAULT 15000,
  is_active BOOLEAN DEFAULT true,
  canvas_width INTEGER DEFAULT 600,
  canvas_height INTEGER DEFAULT 1050,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID,
  frame_id UUID REFERENCES frames(id),
  status VARCHAR(50) DEFAULT 'pending',
  photos_urls TEXT[] DEFAULT '{}',
  final_image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES sessions(id),
  xendit_invoice_id VARCHAR(255) NOT NULL,
  xendit_qr_string TEXT,
  amount INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Settings table
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_frames_active ON frames(is_active);
CREATE INDEX idx_sessions_payment ON sessions(payment_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_payments_session ON payments(session_id);
CREATE INDEX idx_payments_xendit ON payments(xendit_invoice_id);
CREATE INDEX idx_settings_key ON settings(key);

-- Enable Row Level Security
ALTER TABLE frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access to active frames
CREATE POLICY "Anyone can read active frames" ON frames
  FOR SELECT USING (is_active = true);

-- Create policies for authenticated operations (you may want to add auth)
CREATE POLICY "Allow all for development" ON frames FOR ALL USING (true);
CREATE POLICY "Allow all for development" ON sessions FOR ALL USING (true);
CREATE POLICY "Allow all for development" ON payments FOR ALL USING (true);
CREATE POLICY "Allow all for development" ON settings FOR ALL USING (true);

-- Enable Realtime for payments
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
```

### 3. Supabase Storage

1. Go to Storage in your Supabase dashboard
2. Create a bucket called `photos`
3. Set the bucket to **public** for easy access
4. Add the following storage policy:

```sql
-- Allow public read access
CREATE POLICY "Public read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'photos');

-- Allow authenticated uploads
CREATE POLICY "Allow uploads" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'photos');
```

### Migration for Existing Databases

If you have an existing database, run this SQL to add canvas size support:

```sql
-- Add canvas size columns to frames table (for existing databases)
ALTER TABLE frames 
  ADD COLUMN IF NOT EXISTS canvas_width INTEGER DEFAULT 600,
  ADD COLUMN IF NOT EXISTS canvas_height INTEGER DEFAULT 1050;

-- Update existing frames with default values if null
UPDATE frames 
SET canvas_width = 600, canvas_height = 1050 
WHERE canvas_width IS NULL OR canvas_height IS NULL;
```

### 4. Xendit Setup

1. Create a Xendit account at https://dashboard.xendit.co
2. Get your API keys from Settings > API Keys
3. Set up a webhook endpoint pointing to `/api/payment/webhook`
4. Configure allowed payment methods (QRIS)

### 5. Install Dependencies

```bash
npm install
```

### 6. Development

```bash
# Run Next.js dev server
npm run dev

# Run with Tauri (desktop app)
npm run tauri dev
```

### 7. Production Build

```bash
# Build Next.js
npm run build

# Build Tauri app
npm run tauri build
```

### 8. Testing Payment Flow (Development)

For testing purposes, you can simulate successful payments without actually paying through Xendit:

1. Start a photo session and proceed to the payment screen
2. Click the **"Simulate Paid"** button (marked with a yellow TEST badge)
3. The payment will be marked as paid and the session will continue

This bypasses Xendit's payment gateway and is useful for:
- Testing the photo capture flow
- Developing without real payment credentials
- Demo purposes

**Note**: This feature is for development/testing only. Remove or disable it in production.

## Usage

### User Flow

1. **Idle Screen** - Tap "Start Session" to begin
2. **Frame Selection** - Swipe through available frames
3. **Payment** - Scan QR code with any QRIS-compatible payment app
4. **Photo Session** - Countdown and capture (3 photos by default)
5. **Review** - See final composite, print or download

### Admin Access

- Press `Ctrl+Shift+A` to open the admin panel
- Or tap the hidden button in the top-right corner

### Admin Features

- Upload frame images (PNG with transparency)
- Define photo slot positions using sliders
- Set prices per frame
- Enable/disable frames

## Project Structure

```
chronoapp/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── frames/route.ts      # Frame CRUD API
│   │   │   ├── payment/
│   │   │   │   ├── create/route.ts  # Create payment
│   │   │   │   ├── status/route.ts  # Check payment status
│   │   │   │   └── webhook/route.ts # Xendit webhook
│   │   │   └── upload/route.ts      # File upload
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── admin/
│   │   │   ├── FrameEditor.tsx      # Visual frame editor
│   │   │   └── FrameManager.tsx     # Frame list management
│   │   ├── booth/
│   │   │   ├── BoothLayout.tsx      # Main booth orchestrator
│   │   │   ├── CaptureScreen.tsx    # Webcam capture
│   │   │   ├── CountdownScreen.tsx  # Countdown animation
│   │   │   ├── FrameSelector.tsx    # Frame carousel
│   │   │   ├── IdleScreen.tsx       # Welcome screen
│   │   │   ├── PaymentScreen.tsx    # QR payment screen
│   │   │   └── ReviewScreen.tsx     # Final review/print
│   │   └── ui/                      # ShadcnUI components
│   ├── lib/
│   │   ├── supabase.ts              # Supabase client & types
│   │   ├── utils.ts                 # Utility functions
│   │   └── xendit.ts                # Xendit API integration
│   └── store/
│       └── booth-store.ts           # Zustand state management
├── src-tauri/                       # Tauri native code
├── public/
└── package.json
```

## License

MIT License
