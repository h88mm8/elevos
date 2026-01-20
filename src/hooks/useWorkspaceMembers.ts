import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { WorkspaceMember, Profile } from '@/types';

interface MemberWithProfile extends WorkspaceMember {
  profile?: Profile;
}

export function useWorkspaceMembers() {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const membersQuery = useQuery({
    queryKey: ['workspace_members', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      
      // First get members
      const { data: members, error } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', currentWorkspace.id);
      
      if (error) throw error;
      
      // Then get profiles for each member
      const userIds = members.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', userIds);
      
      // Combine data
      return members.map(member => ({
        ...member,
        profile: profiles?.find(p => p.user_id === member.user_id)
      })) as MemberWithProfile[];
    },
    enabled: !!currentWorkspace,
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('workspace_members')
        .delete()
        .eq('id', memberId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace_members', currentWorkspace?.id] });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: 'admin' | 'member' }) => {
      const { error } = await supabase
        .from('workspace_members')
        .update({ role })
        .eq('id', memberId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace_members', currentWorkspace?.id] });
    },
  });

  return {
    members: membersQuery.data ?? [],
    isLoading: membersQuery.isLoading,
    isError: membersQuery.isError,
    removeMember: removeMemberMutation.mutateAsync,
    updateRole: updateRoleMutation.mutateAsync,
    refetchMembers: () => queryClient.invalidateQueries({ queryKey: ['workspace_members', currentWorkspace?.id] }),
  };
}
