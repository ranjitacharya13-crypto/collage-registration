// Deploy with: supabase functions deploy send-registration-email
// Set secret with: supabase secrets set RESEND_API_KEY=your_key
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve(async (request) => {
  const registration = await request.json();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Aura 2026 <onboarding@resend.dev>', to: ['ranjitacharya13@gmail.com'], subject: `New Aura registration: ${registration.event}`, text: `${registration.name} (${registration.department}, Year ${registration.year})\nPhone: ${registration.phone}\nEmail: ${registration.email}` }),
  });
  return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
});
