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

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required.",
      });
    }

    // Run independent async work in parallel instead of sequentially
    const [loginEmail, hashedPassword] = await Promise.all([
      generateUniqueCompanyEmail(client, companyName, LOGIN_EMAIL_DOMAIN),
      bcrypt.hash(password, 10),
    ]);

    await client.query("BEGIN");

    // Single round trip: insert company, insert user, patch owner_id, return both
    const result = await client.query(
      `WITH new_company AS (
        INSERT INTO companies
          (name, contact_email, phone, address, industry, website, revenue, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NOW())
        RETURNING id, name, contact_email, phone, address, industry, website, revenue, status, created_at
      ),
      new_user AS (
        INSERT INTO users (company_id, name, email, password, role, status, created_at)
        SELECT id, $8, $9, $10, 'company', 'active', NOW()
        FROM new_company
        RETURNING id, company_id, name, email, role, status
      ),
      updated_company AS (
        UPDATE companies c
        SET owner_id = nu.id
        FROM new_user nu
        WHERE c.id = nu.company_id
        RETURNING c.id, c.name, c.contact_email, c.phone, c.address,
                  c.industry, c.website, c.revenue, c.status, c.created_at, c.owner_id
      )
      SELECT
        (SELECT row_to_json(updated_company) FROM updated_company) AS company,
        (SELECT row_to_json(new_user) FROM new_user) AS owner`,
      [
        companyName,
        contactEmail || null,
        phone || null,
        address || null,
        industry || null,
        website || null,
        payment || 0,
        ownerName,
        loginEmail,
        hashedPassword,
      ]
    );

    await client.query("COMMIT");

    const { company, owner } = result.rows[0];

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