const ExcelJS = require('exceljs');
const pool = require('../../config/db');
const {
  uploadBufferToCloudinary,
  destroyCloudinaryImage,
} = require('../../config/cloudinary');
const {
  hashPassword,
} = require('./Password.util');


/*
|--------------------------------------------------------------------------
| CREATE COMPANY
|--------------------------------------------------------------------------
| POST /api/super-admin/companies
|--------------------------------------------------------------------------
*/

const createCompany = async (req, res, next) => {
  let dbClient;
  let uploadedReceipt = null;

  try {
    dbClient = await pool.connect();

    const {
      name,
      industry,
      account_owner,
      email,
      password,
      company_size,
      platform_fee,
      location,
      status = 'active',
      payment_status = 'pending',
    } = req.body;


    /*
    |--------------------------------------------------------------------------
    | Validation
    |--------------------------------------------------------------------------
    */

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Company name is required',
      });
    }

    if (!account_owner || !String(account_owner).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Account owner is required',
      });
    }

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Company login email is required',
      });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    if (
      platform_fee === undefined ||
      platform_fee === null ||
      platform_fee === '' ||
      Number.isNaN(Number(platform_fee)) ||
      Number(platform_fee) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment amount is required',
      });
    }


    /*
    |--------------------------------------------------------------------------
    | Normalize Data
    |--------------------------------------------------------------------------
    */

    const companyName = String(name).trim();

    const ownerName =
      String(account_owner).trim();

    const loginEmail =
      String(email).trim().toLowerCase();

    const companyIndustry =
      industry
        ? String(industry).trim()
        : null;

    const companyAddress =
      location
        ? String(location).trim()
        : null;

    const normalizedCompanySize =
      company_size
        ? String(company_size).trim()
        : null;

    const companyStatus =
      String(status).trim().toLowerCase();

    const paymentStatus =
      String(payment_status)
        .trim()
        .toLowerCase();

    const platformFee =
      Number(platform_fee);

    let paymentReceiptUrl = null;
    let paymentReceiptPublicId = null;

    if (req.file) {
      uploadedReceipt = await uploadBufferToCloudinary(
        req.file.buffer,
        {
          folder: 'worknest/payment-receipts',
          public_id: `company-receipt-${Date.now()}`,
        }
      );

      paymentReceiptUrl = uploadedReceipt.secure_url;
      paymentReceiptPublicId = uploadedReceipt.public_id;
    }


    /*
    |--------------------------------------------------------------------------
    | Start Transaction
    |--------------------------------------------------------------------------
    */

    await dbClient.query('BEGIN');


    /*
    |--------------------------------------------------------------------------
    | Check Existing User Email
    |--------------------------------------------------------------------------
    */

    const emailCheckQuery = `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `;

    const {
      rows: existingUsers,
    } = await dbClient.query(
      emailCheckQuery,
      [loginEmail]
    );


    if (existingUsers.length > 0) {
      await dbClient.query('ROLLBACK');

      return res.status(409).json({
        success: false,
        message:
          'A user with this email already exists',
      });
    }


    /*
    |--------------------------------------------------------------------------
    | Check Existing Company Email
    |--------------------------------------------------------------------------
    */

    const companyEmailCheckQuery = `
      SELECT id
      FROM companies
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `;

    const {
      rows: existingCompanyEmails,
    } = await dbClient.query(
      companyEmailCheckQuery,
      [loginEmail]
    );


    if (existingCompanyEmails.length > 0) {
      await dbClient.query('ROLLBACK');

      return res.status(409).json({
        success: false,
        message:
          'A company with this email already exists',
      });
    }


    /*
    |--------------------------------------------------------------------------
    | Check Duplicate Company Name
    |--------------------------------------------------------------------------
    */

    const companyCheckQuery = `
      SELECT id
      FROM companies
      WHERE LOWER(name) = LOWER($1)
      LIMIT 1
    `;

    const {
      rows: existingCompanies,
    } = await dbClient.query(
      companyCheckQuery,
      [companyName]
    );


    if (existingCompanies.length > 0) {
      await dbClient.query('ROLLBACK');

      return res.status(409).json({
        success: false,
        message:
          'A company with this name already exists',
      });
    }


    /*
    |--------------------------------------------------------------------------
    | Hash Company Admin Password
    |--------------------------------------------------------------------------
    */

    const hashedPassword =
      await hashPassword(password);


    /*
    |--------------------------------------------------------------------------
    | Create Company
    |--------------------------------------------------------------------------
    */

    const companyQuery = `
      INSERT INTO companies (
        name,
        email,
        industry,
        address,
        company_size,
        status,
        platform_fee,
        payment_status,
        payment_receipt,
        payment_receipt_public_id,
        created_at,
        updated_at
      )

      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        NOW(),
        NOW()
      )

      RETURNING
        id,
        name,
        email,
        industry,
        address,
        company_size,
        status,
        platform_fee,
        payment_status,
        payment_receipt,
        payment_receipt_public_id,
        created_at,
        updated_at
    `;


    const {
      rows: companyRows,
    } = await dbClient.query(
      companyQuery,
      [
        companyName,
        loginEmail,
        companyIndustry,
        companyAddress,
        normalizedCompanySize,
        companyStatus,
        platformFee,
        paymentStatus,
        paymentReceiptUrl,
        paymentReceiptPublicId,
      ]
    );


    const company =
      companyRows[0];


    /*
    |--------------------------------------------------------------------------
    | Create Company Admin User
    |--------------------------------------------------------------------------
    */

    const userQuery = `
      INSERT INTO users (
        name,
        email,
        password,
        role,
        company_id,
        status,
        created_at,
        updated_at
      )

      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        NOW(),
        NOW()
      )

      RETURNING
        id,
        name,
        email,
        role,
        company_id,
        status,
        created_at
    `;


    const {
      rows: userRows,
    } = await dbClient.query(
      userQuery,
      [
        ownerName,
        loginEmail,
        hashedPassword,
        'companyAdmin',
        company.id,
        'active',
      ]
    );


    /*
    |--------------------------------------------------------------------------
    | Commit Transaction
    |--------------------------------------------------------------------------
    */

    await dbClient.query('COMMIT');


    /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

    return res.status(201).json({
      success: true,

      message:
        'Company created successfully',

      company,

      company_admin:
        userRows[0],
    });

  } catch (error) {

    if (uploadedReceipt?.public_id) {
      try {
        await destroyCloudinaryImage(uploadedReceipt.public_id);
      } catch (cleanupError) {
        console.error(
          '❌ Payment receipt cleanup error:',
          cleanupError
        );
      }
    }

    if (dbClient) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          '❌ Rollback error:',
          rollbackError
        );
      }
    }

    console.error(
      '❌ createCompany error:',
      error
    );

    next(error);

  } finally {

    if (dbClient) {
      dbClient.release();
    }

  }
};


/*
|--------------------------------------------------------------------------
| GET ALL COMPANIES
|--------------------------------------------------------------------------
| GET /api/super-admin/companies
|--------------------------------------------------------------------------
*/

const getAllCompanies = async (
  req,
  res,
  next
) => {

  try {

    const {
      status = 'all',
      industry = 'all',
      payment_status = 'all',
      search = '',
    } = req.query;


    let query = `
      SELECT

        c.id,
        c.name,
        c.email,
        c.industry,
        c.phone,
        c.address,
        c.company_size,
        c.website,
        c.status,
        c.platform_fee,
        c.payment_status,
        c.payment_receipt,
        c.payment_receipt_public_id,
        c.created_at,
        c.updated_at,

        u.id AS admin_user_id,
        u.name AS account_owner,
        u.email AS login_email,
        u.role AS admin_role

      FROM companies c

      LEFT JOIN LATERAL (

        SELECT
          id,
          name,
          email,
          role

        FROM users

        WHERE company_id = c.id

          AND LOWER(role) IN (
            'companyadmin',
            'company_admin'
          )

        ORDER BY id ASC

        LIMIT 1

      ) u ON true

      WHERE 1 = 1
    `;


    const values = [];

    let index = 1;


    /*
    |--------------------------------------------------------------------------
    | Status Filter
    |--------------------------------------------------------------------------
    */

    if (
      status &&
      String(status).toLowerCase() !== 'all'
    ) {

      query += `
        AND LOWER(c.status)
        = LOWER($${index})
      `;

      values.push(status);

      index++;
    }


    /*
    |--------------------------------------------------------------------------
    | Industry Filter
    |--------------------------------------------------------------------------
    */

    if (
      industry &&
      String(industry).toLowerCase() !== 'all'
    ) {

      query += `
        AND LOWER(c.industry)
        = LOWER($${index})
      `;

      values.push(industry);

      index++;
    }


    /*
    |--------------------------------------------------------------------------
    | Payment Status Filter
    |--------------------------------------------------------------------------
    */

    if (
      payment_status &&
      String(payment_status).toLowerCase() !== 'all'
    ) {

      query += `
        AND LOWER(c.payment_status)
        = LOWER($${index})
      `;

      values.push(payment_status);

      index++;
    }


    /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

    if (
      search &&
      String(search).trim()
    ) {

      query += `
        AND (
          c.name ILIKE $${index}
          OR c.email ILIKE $${index}
          OR c.industry ILIKE $${index}
          OR c.address ILIKE $${index}
          OR u.name ILIKE $${index}
          OR u.email ILIKE $${index}
        )
      `;

      values.push(
        `%${String(search).trim()}%`
      );

      index++;
    }


    /*
    |--------------------------------------------------------------------------
    | Order
    |--------------------------------------------------------------------------
    */

    query += `
      ORDER BY c.created_at DESC
    `;


    const {
      rows: companies,
    } = await pool.query(
      query,
      values
    );


    return res.status(200).json({

      success: true,

      count:
        companies.length,

      companies,

    });

  } catch (error) {

    console.error(
      '❌ getAllCompanies error:',
      error
    );

    next(error);
  }
};


/*
|--------------------------------------------------------------------------
| GET COMPANY BY ID
|--------------------------------------------------------------------------
| GET /api/super-admin/companies/:companyId
|--------------------------------------------------------------------------
*/

const getCompanyById = async (
  req,
  res,
  next
) => {

  try {

    const {
      companyId,
    } = req.params;


    const query = `
      SELECT

        c.id,
        c.name,
        c.email,
        c.industry,
        c.phone,
        c.address,
        c.company_size,
        c.website,
        c.status,
        c.platform_fee,
        c.payment_status,
        c.payment_receipt,
        c.payment_receipt_public_id,
        c.created_at,
        c.updated_at,

        u.id AS admin_user_id,
        u.name AS admin_name,
        u.email AS login_email,
        u.role AS admin_role,
        u.status AS admin_status

      FROM companies c

      LEFT JOIN LATERAL (

        SELECT
          id,
          name,
          email,
          role,
          status

        FROM users

        WHERE company_id = c.id

          AND LOWER(role) IN (
            'companyadmin',
            'company_admin'
          )

        ORDER BY id ASC

        LIMIT 1

      ) u ON true

      WHERE c.id = $1

      LIMIT 1
    `;


    const {
      rows,
    } = await pool.query(
      query,
      [companyId]
    );


    if (rows.length === 0) {

      return res.status(404).json({

        success: false,

        message:
          'Company not found',

      });

    }


    return res.status(200).json({

      success: true,

      company: rows[0],

    });

  } catch (error) {

    console.error(
      '❌ getCompanyById error:',
      error
    );

    next(error);
  }
};


/*
|--------------------------------------------------------------------------
| UPDATE COMPANY
|--------------------------------------------------------------------------
| PUT /api/super-admin/companies/:companyId
| Body: { companyName, status, industry, address }
|--------------------------------------------------------------------------
*/

const COMPANY_DETAIL_SELECT = `
  SELECT
    c.id,
    c.name,
    c.email,
    c.industry,
    c.phone,
    c.address,
    c.company_size,
    c.website,
    c.status,
    c.platform_fee,
    c.payment_status,
    c.payment_receipt,
    c.payment_receipt_public_id,
    c.created_at,
    c.updated_at,
    u.id AS admin_user_id,
    u.name AS admin_name,
    u.email AS login_email,
    u.role AS admin_role,
    u.status AS admin_status
  FROM companies c
  LEFT JOIN LATERAL (
    SELECT id, name, email, role, status
    FROM users
    WHERE company_id = c.id
      AND LOWER(role) IN ('companyadmin', 'company_admin')
    ORDER BY id ASC
    LIMIT 1
  ) u ON true
  WHERE c.id = $1
  LIMIT 1
`;

const updateCompany = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const parsedId = Number(companyId);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'Invalid company id',
      });
    }

    const companyName = String(req.body.name).trim();
    const companyStatus = String(req.body.status).trim().toLowerCase();
    const companyIndustry = String(req.body.industry).trim();
    const companyAddress = String(req.body.address).trim();

    const existing = await pool.query(
      'SELECT id FROM companies WHERE id = $1 LIMIT 1',
      [parsedId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'Company not found',
      });
    }

    const duplicate = await pool.query(
      `SELECT id
       FROM companies
       WHERE LOWER(name) = LOWER($1)
         AND id <> $2
       LIMIT 1`,
      [companyName, parsedId]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        code: 409,
        message: 'A company with this name already exists',
      });
    }

    await pool.query(
      `UPDATE companies
       SET
         name = $1,
         status = $2,
         industry = $3,
         address = $4,
         updated_at = NOW()
       WHERE id = $5`,
      [companyName, companyStatus, companyIndustry, companyAddress, parsedId]
    );

    const { rows } = await pool.query(COMPANY_DETAIL_SELECT, [parsedId]);

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Company updated successfully',
      company: rows[0],
    });
  } catch (error) {
    console.error('❌ updateCompany error:', error);
    next(error);
  }
};


/*
|--------------------------------------------------------------------------
| DELETE COMPANY
|--------------------------------------------------------------------------
| DELETE /api/super-admin/companies/:companyId
|--------------------------------------------------------------------------
*/

const deleteCompany = async (req, res, next) => {
  let dbClient;

  try {
    const { companyId } = req.params;
    const parsedId = Number(companyId);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'Invalid company id',
      });
    }

    dbClient = await pool.connect();
    await dbClient.query('BEGIN');

    const existing = await dbClient.query(
      `SELECT id, name, payment_receipt_public_id
       FROM companies
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [parsedId]
    );

    if (existing.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'Company not found',
      });
    }

    const company = existing.rows[0];

    await dbClient.query('DELETE FROM companies WHERE id = $1', [parsedId]);
    await dbClient.query('COMMIT');

    if (company.payment_receipt_public_id) {
      try {
        await destroyCloudinaryImage(company.payment_receipt_public_id);
      } catch (cloudinaryError) {
        console.error(
          '⚠️ Failed to delete company payment receipt from Cloudinary:',
          cloudinaryError.message
        );
      }
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Company deleted successfully',
      data: {
        id: company.id,
        name: company.name,
      },
    });
  } catch (error) {
    if (dbClient) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('❌ deleteCompany rollback error:', rollbackError);
      }
    }

    console.error('❌ deleteCompany error:', error);
    next(error);
  } finally {
    if (dbClient) dbClient.release();
  }
};


/*
|--------------------------------------------------------------------------
| GET SUPER ADMIN DASHBOARD
|--------------------------------------------------------------------------
| GET /api/super-admin/dashboard
|--------------------------------------------------------------------------
*/

const getDashboard = async (
  req,
  res,
  next
) => {

  try {

    /*
    |--------------------------------------------------------------------------
    | Company Statistics
    |--------------------------------------------------------------------------
    */

    const companyStatsQuery = `
      SELECT

        COUNT(*)::int
          AS total_companies,

        COUNT(
          CASE
            WHEN LOWER(
              COALESCE(status, '')
            ) = 'active'

            THEN 1
          END
        )::int
          AS active_companies,

        COUNT(
          CASE
            WHEN created_at >=
              DATE_TRUNC(
                'month',
                CURRENT_DATE
              )

            THEN 1
          END
        )::int
          AS new_this_month,

        COUNT(
          CASE
            WHEN LOWER(
              COALESCE(status, '')
            ) IN (
              'pending',
              'pending approval'
            )

            THEN 1
          END
        )::int
          AS pending_approval,

        COUNT(
          CASE
            WHEN LOWER(
              COALESCE(status, '')
            ) IN (
              'suspended',
              'inactive'
            )

            THEN 1
          END
        )::int
          AS suspended

      FROM companies
    `;


    const {
      rows: companyStatsRows,
    } = await pool.query(
      companyStatsQuery
    );


    const companyStats =
      companyStatsRows[0] || {};


    /*
    |--------------------------------------------------------------------------
    | Total Employees
    |--------------------------------------------------------------------------
    */

    const employeeQuery = `
      SELECT
        COUNT(*)::int
          AS total_employees

      FROM users

      WHERE company_id IS NOT NULL

        AND LOWER(
          COALESCE(role, '')
        ) NOT IN (

          'superadmin',
          'super_admin',

          'companyadmin',
          'company_admin',

          'client'

        )
    `;


    const {
      rows: employeeRows,
    } = await pool.query(
      employeeQuery
    );


    /*
    |--------------------------------------------------------------------------
    | Revenue
    |--------------------------------------------------------------------------
    |
    | Platform revenue comes from:
    |
    | companies.platform_fee
    |
    */

    const revenueQuery = `
      SELECT

        COALESCE(
          SUM(
            CASE

              WHEN LOWER(
                COALESCE(
                  payment_status,
                  ''
                )
              ) = 'paid'

              THEN COALESCE(
                platform_fee,
                0
              )

              ELSE 0

            END
          ),
          0
        ) AS total_revenue,


        COALESCE(
          SUM(
            CASE

              WHEN LOWER(
                COALESCE(
                  payment_status,
                  ''
                )
              ) = 'pending'

              THEN COALESCE(
                platform_fee,
                0
              )

              ELSE 0

            END
          ),
          0
        ) AS pending_revenue,


        COALESCE(
          SUM(
            CASE

              WHEN LOWER(
                COALESCE(
                  payment_status,
                  ''
                )
              ) IN (
                'failed',
                'cancelled'
              )

              THEN COALESCE(
                platform_fee,
                0
              )

              ELSE 0

            END
          ),
          0
        ) AS failed_revenue,


        COUNT(
          CASE

            WHEN LOWER(
              COALESCE(
                payment_status,
                ''
              )
            ) = 'paid'

            THEN 1

          END
        )::int
          AS paid_companies

      FROM companies
    `;


    const {
      rows: revenueRows,
    } = await pool.query(
      revenueQuery
    );


    const revenue =
      revenueRows[0] || {};


    /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({

      success: true,

      data: {

        total_companies:
          Number(
            companyStats.total_companies || 0
          ),

        active_companies:
          Number(
            companyStats.active_companies || 0
          ),

        new_this_month:
          Number(
            companyStats.new_this_month || 0
          ),

        total_employees:
          Number(
            employeeRows[0]?.total_employees || 0
          ),

        pending_approval:
          Number(
            companyStats.pending_approval || 0
          ),

        suspended:
          Number(
            companyStats.suspended || 0
          ),

        revenue: {

          total:
            Number(
              revenue.total_revenue || 0
            ),

          pending:
            Number(
              revenue.pending_revenue || 0
            ),

          paid_companies:
            Number(
              revenue.paid_companies || 0
            ),

          failed:
            Number(
              revenue.failed_revenue || 0
            ),

        },

      },

    });

  } catch (error) {

    console.error(
      '❌ getDashboard error:',
      error
    );

    next(error);
  }
};


/*
|--------------------------------------------------------------------------
| GET REVENUE
|--------------------------------------------------------------------------
| GET /api/super-admin/revenue
|--------------------------------------------------------------------------
*/

const getRevenue = async (
  req,
  res,
  next
) => {

  try {

    const {
      status = 'all',
    } = req.query;


    /*
    |--------------------------------------------------------------------------
    | Revenue Summary
    |--------------------------------------------------------------------------
    */

    const summaryQuery = `
      SELECT

        COALESCE(
          SUM(
            CASE

              WHEN LOWER(
                COALESCE(
                  payment_status,
                  ''
                )
              ) = 'paid'

              THEN COALESCE(
                platform_fee,
                0
              )

              ELSE 0

            END
          ),
          0
        ) AS total_revenue,


        COALESCE(
          SUM(
            CASE

              WHEN LOWER(
                COALESCE(
                  payment_status,
                  ''
                )
              ) = 'pending'

              THEN COALESCE(
                platform_fee,
                0
              )

              ELSE 0

            END
          ),
          0
        ) AS pending_revenue,


        COALESCE(
          SUM(
            CASE

              WHEN LOWER(
                COALESCE(
                  payment_status,
                  ''
                )
              ) IN (
                'failed',
                'cancelled'
              )

              THEN COALESCE(
                platform_fee,
                0
              )

              ELSE 0

            END
          ),
          0
        ) AS failed_revenue,


        COUNT(
          CASE

            WHEN LOWER(
              COALESCE(
                payment_status,
                ''
              )
            ) = 'paid'

            THEN 1

          END
        )::int
          AS paid_companies

      FROM companies
    `;


    const {
      rows: summaryRows,
    } = await pool.query(
      summaryQuery
    );


    /*
    |--------------------------------------------------------------------------
    | Payment Records
    |--------------------------------------------------------------------------
    */

    let paymentsQuery = `
      SELECT

        c.id,

        c.name
          AS company,

        u.name
          AS owner,

        c.email,

        c.platform_fee
          AS revenue,

        c.payment_status,

        c.address
          AS location,

        c.created_at

      FROM companies c

      LEFT JOIN LATERAL (

        SELECT
          name

        FROM users

        WHERE company_id = c.id

          AND LOWER(role) IN (
            'company',
            'companyadmin',
            'company_admin'
          )

        ORDER BY id ASC

        LIMIT 1

      ) u ON true

      WHERE 1 = 1
    `;


    const values = [];

    let index = 1;


    /*
    |--------------------------------------------------------------------------
    | Status Filter
    |--------------------------------------------------------------------------
    */

    if (
      status &&
      String(status).toLowerCase() !== 'all'
    ) {

      paymentsQuery += `
        AND LOWER(
          c.payment_status
        )
        = LOWER($${index})
      `;

      values.push(status);

      index++;
    }


    paymentsQuery += `
      ORDER BY
        c.created_at DESC
    `;


    const {
      rows: payments,
    } = await pool.query(
      paymentsQuery,
      values
    );


    const summary =
      summaryRows[0] || {};


    return res.status(200).json({

      success: true,

      summary: {

        total_revenue:
          Number(
            summary.total_revenue || 0
          ),

        pending_revenue:
          Number(
            summary.pending_revenue || 0
          ),

        paid_companies:
          Number(
            summary.paid_companies || 0
          ),

        failed_revenue:
          Number(
            summary.failed_revenue || 0
          ),

      },

      payments,

    });

  } catch (error) {

    console.error(
      '❌ getRevenue error:',
      error
    );

    next(error);
  }
};


/*
|--------------------------------------------------------------------------
| EXPORT REVENUE
|--------------------------------------------------------------------------
| GET /api/super-admin/revenue/export
| Downloads all revenue records as an Excel (.xlsx) file.
|--------------------------------------------------------------------------
*/

const exportRevenue = async (
  req,
  res,
  next
) => {

  try {

    const {
      status = 'all',
    } = req.query;


    let query = `
      SELECT

        c.name
          AS company,

        u.name
          AS owner,

        c.email,

        c.platform_fee
          AS revenue,

        c.payment_status,

        c.address
          AS location,

        c.created_at

      FROM companies c

      LEFT JOIN LATERAL (

        SELECT
          name

        FROM users

        WHERE company_id = c.id

          AND LOWER(role) IN (
            'company',
            'companyadmin',
            'company_admin'
          )

        ORDER BY id ASC

        LIMIT 1

      ) u ON true

      WHERE 1 = 1
    `;


    const values = [];

    let index = 1;


    /*
    |--------------------------------------------------------------------------
    | Filter
    |--------------------------------------------------------------------------
    */

    if (
      status &&
      String(status).toLowerCase() !== 'all'
    ) {

      query += `
        AND LOWER(
          c.payment_status
        )
        = LOWER($${index})
      `;

      values.push(status);

      index++;
    }


    query += `
      ORDER BY
        c.created_at DESC
    `;


    const {
      rows,
    } = await pool.query(
      query,
      values
    );


    /*
    |--------------------------------------------------------------------------
    | Build Excel Workbook
    |--------------------------------------------------------------------------
    */

    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'WorkNest';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Revenue', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    worksheet.columns = [
      { header: 'Company', key: 'company', width: 28 },
      { header: 'Owner', key: 'owner', width: 22 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Revenue', key: 'revenue', width: 14 },
      { header: 'Payment Status', key: 'payment_status', width: 18 },
      { header: 'Location', key: 'location', width: 24 },
      { header: 'Created At', key: 'created_at', width: 22 },
    ];

    worksheet.getRow(1).font = { bold: true };

    rows.forEach((row) => {
      worksheet.addRow({
        company: row.company || '',
        owner: row.owner || '',
        email: row.email || '',
        revenue: Number(row.revenue || 0),
        payment_status: row.payment_status || '',
        location: row.location || '',
        created_at: row.created_at
          ? new Date(row.created_at)
          : '',
      });
    });

    worksheet.getColumn('revenue').numFmt = '#,##0.00';
    worksheet.getColumn('created_at').numFmt = 'yyyy-mm-dd hh:mm:ss';


    /*
    |--------------------------------------------------------------------------
    | Download
    |--------------------------------------------------------------------------
    */

    const date =
      new Date()
        .toISOString()
        .split('T')[0];


    const fileName =
      `worknest-revenue-${date}.xlsx`;


    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );


    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`
    );


    await workbook.xlsx.write(res);

    return res.end();

  } catch (error) {

    console.error(
      '❌ exportRevenue error:',
      error
    );

    next(error);
  }
};


/*
|--------------------------------------------------------------------------
| EXPORT CONTROLLERS
|--------------------------------------------------------------------------
*/

module.exports = {

  createCompany,

  getAllCompanies,

  getCompanyById,

  updateCompany,

  deleteCompany,

  getDashboard,

  getRevenue,

  exportRevenue,

};