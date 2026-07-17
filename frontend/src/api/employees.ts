import { apiClient } from './client';
import { Employee } from '../types';

export interface EmployeeListResponse {
  data: Employee[];
  total: number;
  page: number;
  limit: number;
}

export const employeesApi = {
  list: async (orgId: string) => {
    const res = await apiClient.get<EmployeeListResponse>(`/employees/org/${orgId}`);
    return res.data;
  },
  create: async (orgId: string, data: Partial<Employee>) => {
    const res = await apiClient.post<Employee>(`/employees/org/${orgId}`, data);
    return res.data;
  },
  update: async (id: string, data: Partial<Employee>) => {
    const res = await apiClient.put<Employee>(`/employees/${id}`, data);
    return res.data;
  },
  delete: async (id: string) => {
    await apiClient.delete(`/employees/${id}`);
  },
  bulkImport: async (orgId: string, employees: Partial<Employee>[]) => {
    const res = await apiClient.post<{ imported: number; employees: Employee[] }>(
      `/employees/org/${orgId}/import`,
      { employees }
    );
    return res.data;
  },
};
