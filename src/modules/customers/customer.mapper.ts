import type { Customer } from "@prisma/client";

// Normalize single customer response
export const mapCustomer = (customer: Customer) => {
  return {
    id: customer.id,

    companyId: customer.companyId,

    firstName: customer.firstName,
    lastName: customer.lastName,

    email: customer.email,
    phone: customer.phone,

    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
};

// Normalize multiple customers response
export const mapCustomers = (
  customer: Customer[]
) => {
  return customer.map(mapCustomer);
};