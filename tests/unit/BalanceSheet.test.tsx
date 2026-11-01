import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BalanceSheet } from '@/components/financial-statements/BalanceSheet';

const { generatePdfMock } = vi.hoisted(() => ({ generatePdfMock: vi.fn() }));

const account = (id: string, code: string, name: string, type: string, balance: number) => ({
  id,
  account_code: code,
  account_name: name,
  account_type: type,
  normal_balance: type === 'asset' ? 'debit' : 'credit',
  current_balance: balance,
});

// The totals balance: 750 = (300 - 50) + (1000 - 500).
const balanceData = {
  assets: [account('a1', '1000', 'Cash', 'asset', 750)],
  liabilities: [
    account('l1', '2000', 'Accounts Payable', 'liability', 300),
    account('l2', '2100', 'Vendor Overpayment', 'liability', -50),
  ],
  equity: [
    account('e1', '3000', 'Owner Capital', 'equity', 1000),
    account('net-income', 'NI', 'Current Period Net Income', 'equity', -500),
  ],
};

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (opts: { queryKey: string[] }) => {
      if (opts.queryKey[0] === 'balance-sheet') return { data: balanceData, isLoading: false };
      return { data: { name: 'Test Restaurant' }, isLoading: false };
    },
  };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/utils/pdfExport', () => ({
  generateFinancialReportPDF: generatePdfMock,
  generateStandardFilename: () => 'balance-sheet',
}));

vi.mock('@/components/financial-statements/shared/ExportDropdown', () => ({
  ExportDropdown: ({ onExportCSV, onExportPDF }: { onExportCSV: () => void; onExportPDF: () => void }) => (
    <>
      <button onClick={onExportCSV}>Export CSV</button>
      <button onClick={onExportPDF}>Export PDF</button>
    </>
  ),
}));

const renderBalanceSheet = () =>
  render(<BalanceSheet restaurantId="resto-1" asOfDate={new Date('2024-01-31T12:00:00')} />);

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

describe('BalanceSheet amount signs', () => {
  beforeEach(() => {
    generatePdfMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a net loss and a liability debit balance as negative amounts', () => {
    renderBalanceSheet();

    expect(screen.getByText('-$500.00')).toBeInTheDocument();
    expect(screen.getByText('-$50.00')).toBeInTheDocument();
  });

  it('writes negative amounts to the CSV file', async () => {
    let csvBlob: Blob | undefined;
    window.URL.createObjectURL = vi.fn((blob: Blob) => {
      csvBlob = blob;
      return 'blob:balance-sheet';
    });
    window.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderBalanceSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    const csv = await readBlob(csvBlob as Blob);
    expect(csv).toContain('NI,Current Period Net Income,-500');
    expect(csv).toContain('2100,Vendor Overpayment,-50');
    expect(csv).toContain('2000,Accounts Payable,300');
  });

  it('sends negative amounts to the PDF file', () => {
    renderBalanceSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));

    const { data } = generatePdfMock.mock.calls[0][0] as { data: { label: string; amount?: number }[] };
    const amountOf = (label: string) => data.find((row) => row.label === label)?.amount;

    expect(amountOf('NI - Current Period Net Income')).toBe(-500);
    expect(amountOf('2100 - Vendor Overpayment')).toBe(-50);
    expect(amountOf('2000 - Accounts Payable')).toBe(300);
  });
});
