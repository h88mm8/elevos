import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePlatformAdmin } from '@/hooks/usePlatformAdmin';
import { Button } from '@/components/ui/button';
import { ElevOSLogo } from '@/components/ElevOSLogo';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  LayoutDashboard, 
  Users, 
  Send, 
  Settings, 
  LogOut,
  ChevronDown,
  Building2,
  Menu,
  Tag,
  Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/campaigns', label: 'Campanhas', icon: Send },
  { href: '/tags', label: 'Tags', icon: Tag },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

function NavItems({ onItemClick, isPlatformAdmin }: { onItemClick?: () => void; isPlatformAdmin?: boolean }) {
  const location = useLocation();
  
  // Build nav items including platform admin if applicable
  const allNavItems = isPlatformAdmin 
    ? [...navItems, { href: '/platform-admin', label: 'Platform Admin', icon: Shield }]
    : navItems;
  
  return (
    <nav className="flex flex-col gap-1">
      {allNavItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.pathname === item.href;
        const isPlatformAdminItem = item.href === '/platform-admin';
        
        return (
          <Link
            key={item.href}
            to={item.href}
            onClick={onItemClick}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isActive 
                ? 'bg-primary text-primary-foreground' 
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              isPlatformAdminItem && 'border-t mt-2 pt-3'
            )}
          >
            <Icon className={cn("h-5 w-5", isPlatformAdminItem && "text-amber-500")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, workspaces, currentWorkspace, setCurrentWorkspace, signOut } = useAuth();
  const { isPlatformAdmin } = usePlatformAdmin();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col border-r bg-card">
        <div className="flex h-16 items-center px-6 border-b">
          <ElevOSLogo />
        </div>
        
        <div className="flex-1 p-4">
          <NavItems isPlatformAdmin={isPlatformAdmin} />
        </div>
        
        <div className="p-4 border-t">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <div className="flex items-center gap-2 truncate">
                  <Building2 className="h-4 w-4" />
                  <span className="truncate">{currentWorkspace?.name || 'Workspace'}</span>
                </div>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => (
                <DropdownMenuItem 
                  key={ws.id}
                  onClick={() => setCurrentWorkspace(ws)}
                  className={cn(ws.id === currentWorkspace?.id && 'bg-muted')}
                >
                  {ws.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64 h-full flex flex-col">
        {/* Header */}
        <header className="flex-shrink-0 z-40 flex h-16 items-center gap-4 border-b bg-card px-4 lg:px-6">
          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild className="lg:hidden">
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <div className="flex h-16 items-center px-6 border-b">
                <ElevOSLogo />
              </div>
              <div className="p-4">
                <NavItems onItemClick={() => setMobileOpen(false)} isPlatformAdmin={isPlatformAdmin} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="flex-1" />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-medium text-primary">
                    {profile?.full_name?.charAt(0) || profile?.email?.charAt(0) || 'U'}
                  </span>
                </div>
                <span className="hidden sm:inline-block">{profile?.full_name || profile?.email}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Minha conta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                Configurações
              </DropdownMenuItem>
              {isPlatformAdmin && (
                <DropdownMenuItem onClick={() => navigate('/platform-admin')}>
                  <Shield className="mr-2 h-4 w-4 text-amber-500" />
                  Platform Admin
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
