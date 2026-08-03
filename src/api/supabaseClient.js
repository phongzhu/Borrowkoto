import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fndvviirhvqrocuycpfr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuZHZ2aWlyaHZxcm9jdXljcGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjM2NDksImV4cCI6MjA5MTczOTY0OX0.FnSt0xhlEIiYur5ye4S1xm9SueGQm5lsArsJlHkX08M';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
