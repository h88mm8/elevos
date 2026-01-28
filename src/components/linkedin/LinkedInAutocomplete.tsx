import { useState, useEffect, useRef, useCallback } from 'react';
import { useLinkedInAutocomplete, AutocompleteOption } from '@/hooks/useLinkedInAutocomplete';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type ParameterType = 'location' | 'industry' | 'company' | 'school' | 'title';

interface LinkedInAutocompleteProps {
  workspaceId: string | undefined;
  type: ParameterType;
  placeholder?: string;
  value: AutocompleteOption[];
  onChange: (value: AutocompleteOption[]) => void;
  disabled?: boolean;
  multiple?: boolean;
  className?: string;
}

export function LinkedInAutocomplete({
  workspaceId,
  type,
  placeholder = 'Buscar...',
  value,
  onChange,
  disabled = false,
  multiple = true,
  className,
}: LinkedInAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { options, isLoading, search, clearOptions } = useLinkedInAutocomplete({
    workspaceId,
    type,
  });

  // Debounced search
  useEffect(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    if (inputValue.length >= 2) {
      const timer = setTimeout(() => {
        search(inputValue);
      }, 300);
      setDebounceTimer(timer);
    } else {
      clearOptions();
    }

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [inputValue]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback((option: AutocompleteOption) => {
    if (multiple) {
      const isAlreadySelected = value.some(v => v.id === option.id);
      if (isAlreadySelected) {
        onChange(value.filter(v => v.id !== option.id));
      } else {
        onChange([...value, option]);
      }
    } else {
      onChange([option]);
      setIsOpen(false);
    }
    setInputValue('');
    clearOptions();
  }, [value, onChange, multiple, clearOptions]);

  const handleRemove = useCallback((id: string) => {
    onChange(value.filter(v => v.id !== id));
  }, [value, onChange]);

  const isSelected = useCallback((id: string) => {
    return value.some(v => v.id === id);
  }, [value]);

  // Only show dropdown with results when we have query >= 2
  const showDropdown = isOpen && inputValue.length >= 2 && options.length > 0;
  
  // Display options in API order, limited to 20
  const displayedOptions = options.slice(0, 20);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Selected items */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {value.map(item => (
            <Badge
              key={item.id}
              variant="secondary"
              className="text-xs gap-1"
            >
              {item.name}
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                className="ml-1 hover:text-destructive"
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="relative">
        <Input
          value={inputValue}
          onChange={e => {
            setInputValue(e.target.value);
            if (e.target.value.length >= 2) {
              setIsOpen(true);
            }
          }}
          onFocus={() => {
            // Only open dropdown if we already have a valid query
            if (inputValue.length >= 2) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-8"
        />
        {isLoading && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* "Type to search" hint when focused but not enough characters */}
      {isOpen && inputValue.length > 0 && inputValue.length < 2 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg p-3 text-sm text-muted-foreground text-center">
          Digite ao menos 2 caracteres para buscar
        </div>
      )}

      {/* Dropdown with results */}
      {showDropdown && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg">
          <ScrollArea className="h-[200px]">
            <div className="p-1">
              {displayedOptions.map(option => {
                const selected = isSelected(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleSelect(option)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted text-left',
                      selected && 'bg-primary/10'
                    )}
                  >
                    {multiple && (
                      <div className={cn(
                        'h-4 w-4 border rounded flex items-center justify-center flex-shrink-0',
                        selected && 'bg-primary border-primary'
                      )}>
                        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    )}
                    <span className="truncate">{option.name}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* No results message */}
      {isOpen && inputValue.length >= 2 && !isLoading && options.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg p-3 text-sm text-muted-foreground text-center">
          Nenhum resultado encontrado
        </div>
      )}
    </div>
  );
}
