import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { format, isBefore, differenceInDays, parse, startOfDay, addDays } from 'date-fns';
import { AlertCircle, CheckCircle2, Clock, PlayCircle, Loader2, RefreshCw, TriangleAlert, ExternalLink, Info } from 'lucide-react';
import { cn } from './lib/utils';

// Types for the Feature Data
interface Feature {
  'Jira Key': string;
  'Description': string;
  'Status': string;
  'KT Date': string;
  'Release Date': string;
}

interface FeatureEnriched extends Feature {
  delayType?: string;
  statusCategory: 'Delayed' | 'At Risk' | 'On Track';
  ktDateObj: Date | null;
  releaseDateObj: Date | null;
}

const DASHBOARD_TITLE = "Feature Delivery Tracker";
const SUB_TITLE = "Engineering Ops & Dashboard";
const SHEET_ID = "1_7cIf3pvclyU60WO03oB2GLEuJjNYuqcc2D3USIF1go";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

export default function App() {
  const [data, setData] = useState<FeatureEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch(CSV_URL);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rawData = results.data as Feature[];
          // Some sheets might have empty rows if not filtered
          const filteredData = rawData.filter(row => row['Jira Key'] && row['Status']);
          const enriched = filteredData.map(item => enrichFeature(item));
          setData(enriched);
          setLastRefreshed(new Date());
          setError(null);
          setLoading(false);
        },
        error: (err: Error) => {
          setError(`Parsing Error: ${err.message}`);
          setLoading(false);
        }
      });
    } catch (err) {
      setError(`Fetch Error: ${err instanceof Error ? err.message : 'Unknown error'}. Ensure the Google Sheet is Published to Web.`);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, []);

  const enrichFeature = (item: Feature): FeatureEnriched => {
    const today = startOfDay(new Date());
    
    // Parse dates (assuming common formats)
    const parseDateStr = (dateStr: string) => {
      if (!dateStr || dateStr.toLowerCase().trim() === 'na' || dateStr.toLowerCase().trim() === 'tbd') return null;
      
      // Handle numeric serial dates from Excel/Sheets occasionally appearing in CSVs
      if (/^\d{5}$/.test(dateStr)) {
        const serial = parseInt(dateStr);
        return startOfDay(addDays(new Date(1899, 11, 30), serial));
      }

      const formats = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MMM-yyyy', 'd-MMM-yy', 'dd-MM-yyyy'];
      for (const f of formats) {
        try {
          const d = parse(dateStr.trim(), f, new Date());
          if (!isNaN(d.getTime())) return startOfDay(d);
        } catch (e) {}
      }
      
      // Fallback to JS Date parse
      const fallback = new Date(dateStr);
      if (!isNaN(fallback.getTime())) return startOfDay(fallback);

      return null;
    };

    const ktDate = parseDateStr(item['KT Date']);
    const releaseDate = parseDateStr(item['Release Date']);
    const status = (item['Status'] || '').trim();

    let delayType = '';
    let statusCategory: 'Delayed' | 'At Risk' | 'On Track' = 'On Track';

    const isReleased = ['Released', 'Done', 'Live'].some(s => status.toLowerCase().includes(s.toLowerCase()));
    const isDev = status.toLowerCase().includes('development') || status.toLowerCase().includes('progress');

    // Logic 1: Not Started Delay
    // KT Date < Today AND Status ≠ "Under Development"
    if (ktDate && isBefore(ktDate, today) && !isDev && !isReleased) {
      delayType = 'KT Overdue';
      statusCategory = 'Delayed';
    }

    // Logic 2: Stuck in Development
    // Status = "Under Development" AND (Today - KT Date > 15 days)
    if (isDev && ktDate && differenceInDays(today, ktDate) > 15) {
      delayType = 'Stuck in Dev (>15d)';
      statusCategory = 'At Risk';
    }

    // Logic 3: Missed Release
    // Release Date < Today AND Status ≠ "Released"
    if (releaseDate && isBefore(releaseDate, today) && !isReleased) {
      delayType = 'Missed Release';
      statusCategory = 'Delayed';
    }

    return {
      ...item,
      delayType,
      statusCategory,
      ktDateObj: ktDate,
      releaseDateObj: releaseDate
    };
  };

  const kpis = useMemo(() => {
    const total = data.length;
    const released = data.filter(f => ['Released', 'Done', 'Live'].some(s => f['Status'].toLowerCase().includes(s.toLowerCase()))).length;
    const dev = data.filter(f => f['Status'].toLowerCase().includes('development') || f['Status'].toLowerCase().includes('progress')).length;
    const delayed = data.filter(f => f.statusCategory === 'Delayed').length;
    const atRisk = data.filter(f => f.statusCategory === 'At Risk').length;
    const notStarted = total - released - dev;

    return { total, released, dev, notStarted, delayed, atRisk };
  }, [data]);

  const focusedItems = useMemo(() => {
    return data
      .filter(f => f.statusCategory !== 'On Track')
      .sort((a, b) => {
        if (!a.releaseDateObj) return 1;
        if (!b.releaseDateObj) return -1;
        return a.releaseDateObj.getTime() - b.releaseDateObj.getTime();
      });
  }, [data]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center p-6 text-center">
        <div className="max-w-md bg-white border border-red-200 p-8 rounded-2xl shadow-sm">
          <TriangleAlert className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Issues</h2>
          <p className="text-gray-600 mb-6 text-sm">{error}</p>
          <button 
            onClick={fetchData}
            className="w-full bg-black text-white py-3 px-6 rounded-xl font-medium hover:bg-neutral-800 transition-colors shadow-lg active:scale-[0.98]"
          >
            Retry Fetch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans selection:bg-blue-100 antialiased p-6">
      <div className="max-w-[960px] mx-auto flex flex-col gap-6">
        {/* Header */}
        <header className="flex justify-between items-end border-b border-[#E2E8F0] pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">{DASHBOARD_TITLE}</h1>
            <p className="text-[12px] text-[#64748B] font-bold uppercase tracking-wider mt-1">{SUB_TITLE}</p>
          </div>
          <div className="text-right">
            <div className="inline-block bg-[#DCFCE7] text-[#166534] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
              System Live
            </div>
            <p className="text-[11px] text-[#94A3B8] font-medium mt-1">
              Last Sync: {format(lastRefreshed, 'HH:mm')}
            </p>
          </div>
        </header>

        {/* KPIs */}
        <section className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <KPICard title="TOTAL" value={kpis.total} />
          <KPICard title="RELEASED" value={kpis.released} />
          <KPICard title="UNDER DEV" value={kpis.dev} />
          <KPICard title="PENDING KT" value={kpis.notStarted} />
          <KPICard title="DELAYED" value={kpis.delayed} variant="danger" />
          <KPICard title="AT RISK" value={kpis.atRisk} variant="warning" />
        </section>

        {/* Focus Items Table */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <div className="px-4 py-4 bg-[#F1F5F9] border-b border-[#E2E8F0] flex justify-between items-center text-[#475569]">
            <h2 className="text-sm font-semibold uppercase tracking-wider">CRITICAL FOCUS ITEMS</h2>
            <div className="text-[11px]">Sorted by Nearest Release</div>
          </div>

          {loading && data.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
              <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">Synchronizing Data Streams</p>
            </div>
          ) : focusedItems.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center px-6">
              <div className="w-16 h-16 bg-[#DCFCE7] rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-[#166534]" />
              </div>
              <h3 className="font-bold text-[#0F172A] text-lg">System nominal.</h3>
              <p className="text-[#64748B] max-w-xs mx-auto text-xs mt-2 leading-relaxed">No critical delays or risks detected.</p>
            </div>
          ) : data.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center px-6">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <Info className="w-8 h-8 text-blue-500" />
              </div>
              <h3 className="font-bold text-[#0F172A] text-lg text-center">No Data Detected.</h3>
              <p className="text-[#64748B] max-w-sm mx-auto text-xs mt-2 leading-relaxed text-center">
                Connected but found no records. Ensure sheet headers are correct & data is published.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                    <th className="px-4 py-3 font-semibold text-[#64748B] uppercase text-[11px]">Jira Key</th>
                    <th className="px-4 py-3 font-semibold text-[#64748B] uppercase text-[11px]">Description</th>
                    <th className="px-4 py-3 font-semibold text-[#64748B] uppercase text-[11px]">Status</th>
                    <th className="px-4 py-3 font-semibold text-[#64748B] uppercase text-[11px] w-32">Target Date</th>
                    <th className="px-4 py-3 font-semibold text-[#64748B] uppercase text-[11px] w-32">Delay Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {focusedItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4 font-mono font-bold text-[#2563EB]">{item['Jira Key']}</td>
                      <td className="px-4 py-4 font-medium text-[#1E293B]">{item['Description']}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center">
                          <span className={cn(
                            "inline-block w-2 h-2 rounded-full mr-2",
                            item.statusCategory === 'Delayed' ? "bg-[#EF4444]" : "bg-[#F59E0B]"
                          )} />
                          <span className="text-[#1E293B] font-medium">{item['Status']}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-[#1E293B]">{item['Release Date'] || '--'}</td>
                      <td className="px-4 py-4">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap",
                          item.statusCategory === 'Delayed' 
                            ? "bg-[#FEE2E2] text-[#991B1B]" 
                            : "bg-[#FFEDD5] text-[#9A3412]"
                        )}>
                          {item.delayType}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="mt-auto flex justify-center gap-6 py-4 font-medium text-[11px] text-[#94A3B8]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#EF4444]" /> Delayed / Missed
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> At Risk / Stuck
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" /> On Track / Released
          </div>
        </div>
      </div>

      {loading && data.length > 0 && (
        <div className="fixed bottom-6 right-6 bg-[#0F172A] text-white px-4 py-2 rounded-lg shadow-xl flex items-center gap-2 z-[60]">
           <RefreshCw className="w-3 h-3 animate-spin" />
           <span className="text-[10px] font-bold uppercase tracking-widest">Refreshing...</span>
        </div>
      )}
    </div>
  );
}

function KPICard({ title, value, variant = 'default' }: { title: string, value: number, variant?: 'default' | 'danger' | 'warning' }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <span className={cn(
        "block text-[11px] font-bold mb-2 tracking-wider",
        variant === 'danger' ? "text-[#EF4444]" : variant === 'warning' ? "text-[#F59E0B]" : "text-[#64748B]"
      )}>{title}</span>
      <div className={cn(
        "text-[20px] font-bold tracking-tight text-[#0F172A]",
        variant === 'danger' && "text-[#EF4444]",
        variant === 'warning' && "text-[#F59E0B]"
      )}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return null; // Not used in the new minimalist design which uses status dots directly
}
