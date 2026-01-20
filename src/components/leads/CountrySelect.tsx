import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// Full list of valid Apify countries (lowercase as required by API)
export const APIFY_COUNTRIES = [
  "afghanistan", "albania", "algeria", "andorra", "angola", "anguilla", 
  "argentina", "armenia", "australia", "austria", "azerbaijan", "bahrain", 
  "bangladesh", "barbados", "belarus", "belgium", "belize", "benin", 
  "bermuda", "bhutan", "bolivia", "bosnia and herzegovina", "botswana", 
  "brazil", "brunei", "bulgaria", "burkina faso", "burundi", "cambodia", 
  "cameroon", "canada", "cayman islands", "central african republic", "chad", 
  "chile", "china", "colombia", "cook islands", "costa rica", 
  "côte d'ivoire", "croatia", "cuba", "cyprus", "czech republic", 
  "democratic republic of the congo", "denmark", "dominica", "dominican republic", 
  "ecuador", "egypt", "el salvador", "equatorial guinea", "estonia", "ethiopia", 
  "falkland islands (islas malvinas)", "fiji", "finland", "france", 
  "french guiana", "french polynesia", "gabon", "georgia", "germany", 
  "ghana", "gibraltar", "greece", "greenland", "guadeloupe", "guam", 
  "guatemala", "guernsey", "guyana", "haiti", "honduras", "hong kong", 
  "hungary", "iceland", "india", "indonesia", "iran", "iraq", "ireland", 
  "isle of man", "israel", "italy", "jamaica", "japan", "jersey", "jordan", 
  "kazakhstan", "kenya", "kiribati", "kosovo", "kuwait", "kyrgyzstan", 
  "laos", "latvia", "lebanon", "lesotho", "liberia", "libya", "liechtenstein", 
  "lithuania", "luxembourg", "macau", "macedonia (fyrom)", "madagascar", 
  "malawi", "malaysia", "maldives", "mali", "malta", "martinique", 
  "mauritania", "mauritius", "mayotte", "mexico", "moldova", "monaco", 
  "mongolia", "montenegro", "morocco", "mozambique", "myanmar", 
  "myanmar (burma)", "namibia", "nauru", "nepal", "netherlands", 
  "new caledonia", "new zealand", "nicaragua", "niger", "nigeria", 
  "northern mariana islands", "norway", "oman", "pakistan", "panama", 
  "papua new guinea", "paraguay", "peru", "philippines", "poland", 
  "portugal", "puerto rico", "qatar", "republic of indonesia", 
  "republic of the congo", "republic of the union of myanmar", "reunion", 
  "romania", "russia", "rwanda", "saint kitts and nevis", "samoa", 
  "saudi arabia", "senegal", "serbia", "seychelles", "sierra leone", 
  "singapore", "slovakia", "slovenia", "solomon islands", "somalia", 
  "south africa", "south korea", "south sudan", "spain", "sri lanka", 
  "sudan", "suriname", "swaziland", "sweden", "switzerland", "syria", 
  "taiwan", "tajikistan", "tanzania", "thailand", "the bahamas", "togo", 
  "tonga", "trinidad and tobago", "tunisia", "turkey", "turkmenistan", 
  "u.s. virgin islands", "uganda", "ukraine", "united arab emirates", 
  "united kingdom", "united states", "uruguay", "uzbekistan", "vanuatu", 
  "venezuela", "vietnam", "western sahara", "yemen", "zambia"
] as const;

// Display names (capitalized for UI)
const formatCountryName = (country: string) => {
  return country
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function CountrySelect({ value, onChange, disabled }: CountrySelectProps) {
  const [open, setOpen] = useState(false);

  const countries = useMemo(() => 
    APIFY_COUNTRIES.map(c => ({
      value: c,
      label: formatCountryName(c),
    })),
    []
  );

  const selectedCountry = countries.find(c => c.value === value.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          {selectedCountry ? (
            <span className="flex items-center gap-2">
              {selectedCountry.label}
            </span>
          ) : (
            <span className="text-muted-foreground">Selecione um país...</span>
          )}
          <div className="flex items-center gap-1">
            {value && (
              <X
                className="h-4 w-4 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('');
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0 bg-popover border shadow-lg z-50" align="start">
        <Command>
          <CommandInput placeholder="Buscar país..." />
          <CommandList>
            <CommandEmpty>Nenhum país encontrado.</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-auto">
              {countries.map((country) => (
                <CommandItem
                  key={country.value}
                  value={country.label}
                  onSelect={() => {
                    onChange(country.value === value.toLowerCase() ? '' : country.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.toLowerCase() === country.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {country.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}