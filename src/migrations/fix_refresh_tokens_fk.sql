-- Fix refresh_tokens foreign key to point to public.users (not auth.users)
-- This fixes the "bigint = uuid" error

BEGIN;

-- Drop existing foreign key if exists (might reference wrong table)
ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_user_id_fkey;

-- Add correct foreign key to public.users
ALTER TABLE refresh_tokens 
ADD CONSTRAINT refresh_tokens_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Clean up any orphaned tokens (where user_id doesn't exist in public.users)
DELETE FROM refresh_tokens 
WHERE user_id NOT IN (SELECT id FROM public.users);

-- Clean up any orphaned tokens in auth schema if they exist
DELETE FROM auth.refresh_tokens 
WHERE user_id NOT IN (SELECT supabase_user_id::text FROM public.users WHERE supabase_user_id IS NOT NULL);

COMMIT;

-- Verify the fix
SELECT 
    tc.table_schema,
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table,
    ccu.column_name AS foreign_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'refresh_tokens';
