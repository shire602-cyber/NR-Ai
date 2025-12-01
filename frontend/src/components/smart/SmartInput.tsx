import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, HelpCircle, Sparkles, Check } from 'lucide-react';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface SmartInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'account' | 'customer' | 'merchant' | 'description';
  accountType?: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  helpText?: string;
  className?: string;
  disabled?: boolean;
  onSelect?: (item: any) => void;
  'data-testid'?: string;
}

interface AccountSuggestion {
  id: string;
  nameEn: string;
  nameAr: string;
  code?: string;
  type: string;
  description: string;
}

interface CustomerSuggestion {
  name: string;
  trn: string | null;
  invoiceCount: number;
}

interface MerchantSuggestion {
  name: string;
  category: string | null;
  receiptCount: number;
  lastAmount: number;
}

interface DescriptionSuggestion {
  text: string;
  usageCount: number;
}

export function SmartInput({
  value,
  onChange,
  placeholder,
  type = 'description',
  accountType,
  helpText,
  className,
  disabled,
  onSelect,
  'data-testid': testId,
}: SmartInputProps) {
  const { companyId } = useDefaultCompany();
  const { locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const debouncedQuery = inputValue.trim().length >= 2 ? inputValue : '';

  const endpointMap = {
    account: '/api/autocomplete/accounts',
    customer: '/api/autocomplete/customers',
    merchant: '/api/autocomplete/merchants',
    description: '/api/autocomplete/descriptions',
  };

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: [endpointMap[type], companyId, debouncedQuery, accountType],
    queryFn: async () => {
      const params = new URLSearchParams({
        companyId: companyId!,
        query: debouncedQuery,
        limit: '8',
      });
      if (accountType) {
        params.set('type', accountType);
      }
      const res = await fetch(`${endpointMap[type]}?${params}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (!res.ok) throw new Error('Failed to fetch suggestions');
      return res.json();
    },
    enabled: !!companyId && debouncedQuery.length >= 2,
    staleTime: 30000,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      onChange(newValue);
    }, 100);

    if (newValue.length >= 2) {
      setOpen(true);
    }
  };

  const handleSelect = useCallback((selectedValue: string, item?: any) => {
    setInputValue(selectedValue);
    onChange(selectedValue);
    setOpen(false);
    if (onSelect && item) {
      onSelect(item);
    }
  }, [onChange, onSelect]);

  const renderSuggestions = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (suggestions.length === 0) {
      return <CommandEmpty>No suggestions found</CommandEmpty>;
    }

    switch (type) {
      case 'account':
        return (
          <CommandGroup heading="Accounts">
            {(suggestions as AccountSuggestion[]).map((account) => (
              <CommandItem
                key={account.id}
                value={account.nameEn}
                onSelect={() => handleSelect(account.nameEn, account)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span>{locale === 'ar' ? account.nameAr : account.nameEn}</span>
                  {account.code && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {account.code}
                    </Badge>
                  )}
                </div>
                <Badge variant="secondary" className="text-xs">
                  {account.type}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        );

      case 'customer':
        return (
          <CommandGroup heading="Customers">
            {(suggestions as CustomerSuggestion[]).map((customer, i) => (
              <CommandItem
                key={`${customer.name}-${i}`}
                value={customer.name}
                onSelect={() => handleSelect(customer.name, customer)}
                className="flex items-center justify-between"
              >
                <div>
                  <span>{customer.name}</span>
                  {customer.trn && (
                    <span className="text-xs text-muted-foreground ml-2">
                      TRN: {customer.trn}
                    </span>
                  )}
                </div>
                <Badge variant="secondary" className="text-xs">
                  {customer.invoiceCount} invoices
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        );

      case 'merchant':
        return (
          <CommandGroup heading="Merchants">
            {(suggestions as MerchantSuggestion[]).map((merchant, i) => (
              <CommandItem
                key={`${merchant.name}-${i}`}
                value={merchant.name}
                onSelect={() => handleSelect(merchant.name, merchant)}
                className="flex items-center justify-between"
              >
                <div>
                  <span>{merchant.name}</span>
                  {merchant.category && (
                    <Badge variant="outline" className="text-xs ml-2">
                      {merchant.category}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {merchant.receiptCount}x
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        );

      case 'description':
        return (
          <CommandGroup heading="Recent Descriptions">
            {(suggestions as DescriptionSuggestion[]).map((desc, i) => (
              <CommandItem
                key={`${desc.text}-${i}`}
                value={desc.text}
                onSelect={() => handleSelect(desc.text)}
                className="flex items-center justify-between"
              >
                <span className="truncate">{desc.text}</span>
                <span className="text-xs text-muted-foreground">
                  {desc.usageCount}x
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        );

      default:
        return null;
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onFocus={() => inputValue.length >= 2 && setOpen(true)}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                "pr-8",
                suggestions.length > 0 && "border-primary/50"
              )}
              data-testid={testId}
            />
            {isLoading && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && suggestions.length > 0 && inputValue.length >= 2 && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent 
          className="p-0 w-[var(--radix-popover-trigger-width)]" 
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command>
            <CommandList>
              {renderSuggestions()}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {helpText && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full w-8 opacity-50 hover:opacity-100"
              type="button"
            >
              <HelpCircle className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <p className="text-sm">{helpText}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function SmartAccountSelect({
  value,
  onChange,
  accountType,
  placeholder,
  disabled,
  'data-testid': testId,
}: {
  value: string;
  onChange: (accountId: string, account?: AccountSuggestion) => void;
  accountType?: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  placeholder?: string;
  disabled?: boolean;
  'data-testid'?: string;
}) {
  const { companyId } = useDefaultCompany();
  const { locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: accounts = [], isLoading } = useQuery<AccountSuggestion[]>({
    queryKey: ['/api/autocomplete/accounts', companyId, accountType],
    queryFn: async () => {
      const params = new URLSearchParams({
        companyId: companyId!,
        limit: '50',
      });
      if (accountType) {
        params.set('type', accountType);
      }
      const res = await fetch(`/api/autocomplete/accounts?${params}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
    enabled: !!companyId,
  });

  const selectedAccount = accounts.find(a => a.id === value);
  const filteredAccounts = search 
    ? accounts.filter(a => 
        a.nameEn.toLowerCase().includes(search.toLowerCase()) ||
        a.nameAr.toLowerCase().includes(search.toLowerCase()) ||
        a.code?.toLowerCase().includes(search.toLowerCase())
      )
    : accounts;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
          data-testid={testId}
        >
          {selectedAccount 
            ? (locale === 'ar' ? selectedAccount.nameAr : selectedAccount.nameEn)
            : placeholder || 'Select account...'}
          {isLoading && <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput 
            placeholder="Search accounts..." 
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {filteredAccounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={account.nameEn}
                  onSelect={() => {
                    onChange(account.id, account);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === account.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex items-center gap-2 flex-1">
                    <span>{locale === 'ar' ? account.nameAr : account.nameEn}</span>
                    {account.code && (
                      <Badge variant="outline" className="text-xs font-mono">
                        {account.code}
                      </Badge>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-xs ml-auto">
                    {account.type}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
