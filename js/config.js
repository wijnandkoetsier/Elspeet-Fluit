// Vul deze twee waarden in met de gegevens van je Supabase-project
// (Project Settings → API). Leeg laten = demo-modus met lokale testdata.
export const SUPABASE_URL = 'https://ggeznlthmfngumelpjss.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZXpubHRobWZuZ3VtZWxwanNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzgzNzQsImV4cCI6MjEwNzcxNDM3NH0.V-VG0ZDwa7NJPCqTDnhoTUj1daaVRjWMb14QSyL5ro8';

// Adres van hosting/sportlink-sync.php op je eigen hosting, voor de knop "Nu ophalen uit Sportlink".
// Op Vimexx: https://scheids.vv-elspeet.nl/sportlink/sportlink-sync.php (zet de workflow mee online). Leeg = geen knop.
export const SPORTLINK_SYNC_URL = 'https://scheids.vv-elspeet.nl/sportlink/sportlink-sync.php';

// Publieke VAPID-sleutel voor pushmeldingen (zie README, stap Pushmeldingen). Leeg = geen push.
export const VAPID_PUBLIC_KEY = 'BFLmQV-DRbPB3PA5DFlRNNHe38iLD27hU11PYqg0gsd9UMzbZF1Lt7Bcxofeypb3Lo9aFPDvAZTlEgN3a7KmUDI';

export const APP_NAME = 'Scheids VV Elspeet';
export const CLUB_NAME = 'VV Elspeet';
// KNVB-categorieën (O = onder, zoals in Sportlink: "Elspeet O13-1").
export const CATEGORIES = ['O7', 'O8', 'O9', 'O10', 'O11', 'O12', 'O13', 'O15', 'O17', 'O19',
  '1e', '2e', '3e', '4e', '5e', '7x7', '35+', '40+', 'VR1', 'VR30+'];
