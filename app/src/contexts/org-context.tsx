import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import {
  useListMemberOrgs,
  useGetOrg,
  useGetOrgPermissions,
} from "@/api/endpoints/orgs/orgs";
import type { OrgMembershipResponse, OrgDetailResponse } from "@/api/model";

export function isMembershipSuspended(
  m: OrgMembershipResponse | null | undefined
): boolean {
  if (!m) {
    return false;
  }
  return Boolean(
    m.org_info.is_suspended || m.membership.membership_status === "suspended"
  );
}

interface OrgContextValue {
  organizations: OrgMembershipResponse[];
  activeOrgId: string | null;
  activeOrg: OrgDetailResponse | null;
  activeMembership: OrgMembershipResponse | null;
  isOrgSuspended: boolean;
  permissions: string[];
  hasPermission: (code: string) => boolean;
  setActiveOrgId: (id: string) => void;
  isLoadingOrgs: boolean;
  refetchOrgs: () => void;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);

const ACTIVE_ORG_STORAGE_KEY = "stickpeel_active_org_id";

export function OrgProvider({ children }: { children: ReactNode }) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    }
    return null;
  });

  const {
    data: organizations = [],
    isLoading: isLoadingOrgs,
    refetch: refetchOrgs,
  } = useListMemberOrgs();

  // Determine activeOrgId: prioritize non-suspended organizations.
  const activeOrgId = useMemo(() => {
    if (!organizations.length) {
      return null;
    }
    const nonSuspended = organizations.filter((m) => !isMembershipSuspended(m));
    const selected = organizations.find(
      (m) => m.org_info.org_id === selectedOrgId
    );

    // If selectedOrgId exists and is NOT suspended, use it.
    if (selected && !isMembershipSuspended(selected)) {
      return selectedOrgId;
    }

    // If selected org was suspended or invalid, fallback to the first active non-suspended org.
    if (nonSuspended.length > 0) {
      return nonSuspended[0]?.org_info.org_id ?? null;
    }

    // If ALL organizations are suspended, fallback to selected or first so the suspended state renders.
    if (selected) {
      return selectedOrgId;
    }
    return organizations[0]?.org_info.org_id ?? null;
  }, [organizations, selectedOrgId]);

  // Keep localStorage in sync with the effective activeOrgId
  useEffect(() => {
    if (activeOrgId) {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, activeOrgId);
    } else {
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    }
  }, [activeOrgId]);

  const activeMembership = useMemo(() => {
    return organizations.find((m) => m.org_info.org_id === activeOrgId) ?? null;
  }, [organizations, activeOrgId]);

  const setActiveOrgId = useCallback(
    (id: string) => {
      const target = organizations.find((m) => m.org_info.org_id === id);
      if (target && isMembershipSuspended(target)) {
        // Do not allow setting a suspended organization!
        return;
      }
      setSelectedOrgId(id);
      if (typeof window !== "undefined") {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, id);
      }
    },
    [organizations]
  );

  const { data: activeOrg = null } = useGetOrg(activeOrgId ?? "", {
    query: {
      enabled: Boolean(activeOrgId),
      retry: false,
    },
  });

  const isOrgSuspended = useMemo(() => {
    if (!activeMembership) {
      return false;
    }
    return (
      isMembershipSuspended(activeMembership) ||
      Boolean(activeOrg?.is_suspended)
    );
  }, [activeMembership, activeOrg]);

  const { data: permissionScopes = [] } = useGetOrgPermissions(
    activeOrgId ?? "",
    {
      query: {
        enabled: Boolean(activeOrgId && !isOrgSuspended),
        retry: false,
      },
    }
  );

  const permissions = useMemo(() => {
    if (isOrgSuspended) {
      return [];
    }
    const permSet = new Set<string>();
    for (const scope of permissionScopes) {
      for (const code of scope.permission_codes) {
        permSet.add(code);
      }
    }
    return Array.from(permSet);
  }, [permissionScopes, isOrgSuspended]);

  const hasPermission = useCallback(
    (code: string) => {
      if (isOrgSuspended) {
        return false;
      }
      return permissions.includes(code);
    },
    [permissions, isOrgSuspended]
  );

  const value = useMemo<OrgContextValue>(
    () => ({
      organizations,
      activeOrgId,
      activeOrg,
      activeMembership,
      isOrgSuspended,
      permissions,
      hasPermission,
      setActiveOrgId,
      isLoadingOrgs,
      refetchOrgs,
    }),
    [
      organizations,
      activeOrgId,
      activeOrg,
      activeMembership,
      isOrgSuspended,
      permissions,
      hasPermission,
      setActiveOrgId,
      isLoadingOrgs,
      refetchOrgs,
    ]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useActiveOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useActiveOrg must be used within an OrgProvider");
  }
  return context;
}
