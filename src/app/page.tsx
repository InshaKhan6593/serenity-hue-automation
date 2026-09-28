import { loadDashboard, monthOptions } from "@/lib/queries";
import { SYNC_START } from "@/lib/sync";
import { Header } from "@/components/dashboard/header";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { UrlToasts } from "@/components/dashboard/url-toasts";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const months = monthOptions(SYNC_START.slice(0, 7));
  const monthParam = typeof params.month === "string" ? params.month : null;
  const month = monthParam && months.includes(monthParam) ? monthParam : null;
  const tab = typeof params.tab === "string" ? params.tab : "invoices";

  const data = await loadDashboard(month);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
      <UrlToasts />
      <Header connections={data.connections} months={months} month={month} />
      <DashboardTabs
        tab={tab}
        saved={data.saved}
        toGet={data.toGet}
        failedEmails={data.failedEmails}
        ignored={data.ignored}
        ignoredTotal={data.ignoredTotal}
      />
    </div>
  );
}
