-- Speed up company user lists sorted by first/last name.
CREATE INDEX "User_companyId_firstName_lastName_idx"
ON "User"("companyId", "firstName", "lastName");
