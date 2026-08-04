async function createCompany(req, res, next) {
  const client = await pool.connect();

  try {
    const errors = validateCreateCompany(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors,
      });
    }

    const {
      companyName,
      ownerName,
      contactEmail,
      phone,
      address,
      industry,
      website,
      password,
      payment,
    } = req.body;

    // Validate password
    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required.",
      });
    }

    await client.query("BEGIN");

    // Generate unique login email
    const loginEmail = await generateUniqueCompanyEmail(
      client,
      companyName,
      LOGIN_EMAIL_DOMAIN
    );

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create company
   const companyResult = await client.query(
  `INSERT INTO companies
  (
    name,
    contact_email,
    phone,
    address,
    industry,
    website,
    revenue,
    status,
    created_at
  )
  VALUES
  ($1,$2,$3,$4,$5,$6,$7,'active',NOW())
  RETURNING
    id,
    name,
    contact_email,
    phone,
    address,
    industry,
    website,
    revenue,
    status,
    created_at`,
  [
    companyName,
    contactEmail || null,
    phone || null,
    address || null,
    industry || null,
    website || null,
    payment || 0,
  ]
);

    const company = companyResult.rows[0];

    // Create owner account
    const userResult = await client.query(
      `INSERT INTO users
      (company_id, name, email, password, role, status, created_at)
      VALUES ($1,$2,$3,$4,'company','active',NOW())
      RETURNING id, name, email, role, status`,
      [company.id, ownerName, loginEmail, hashedPassword]
    );

    const owner = userResult.rows[0];

    // Update owner_id in companies table
    await client.query(
      "UPDATE companies SET owner_id = $1 WHERE id = $2",
      [owner.id, company.id]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Company created successfully.",
      data: {
        company,
        owner,
        credentials: {
          loginEmail,
          password,
        },
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}