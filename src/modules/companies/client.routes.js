const express = require('express');
const bcrypt = require('bcrypt');

const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router({ mergeParams: true });


const validateEmail = (value) =>
  /^\S+@\S+\.\S+$/.test(String(value || '').trim());


// ===============================
// Load Company
// ===============================

async function loadCompany(req,res,next){

    try{

        const result = await pool.query(
            `SELECT company_id 
             FROM users 
             WHERE id=$1`,
             [req.user.id]
        );


        const companyId =
            result.rows[0]?.company_id ||
            req.user.companyId;


        if(!companyId){

            return res.status(403).json({
                success:false,
                message:"User does not belong to a company"
            });

        }


        req.company={
            id:companyId
        };


        next();


    }catch(error){

        next(error);

    }

}



const authorizeRole = (...roles)=>(req,res,next)=>{


    if(!roles.includes(req.user.role)){

        return res.status(403).json({

            success:false,
            message:"You do not have access to this resource"

        });

    }


    next();

};



router.use(protect,loadCompany);




// =================================================
// CREATE CLIENT + CLIENT LOGIN ACCOUNT
// POST /api/company/clients
// =================================================


router.post('/', authorizeRole(
    'company',
    'super_admin'
), async(req,res,next)=>{


const client = await pool.connect();


try{


const {
    name,
    email,
    password,
    phone,
    company:clientCompany,
    address,
    notes
}=req.body;



if(!name){

return res.status(400).json({

success:false,
message:"Client name is required"

});

}



if(!email || !validateEmail(email)){


return res.status(400).json({

success:false,
message:"Valid email is required"

});


}



if(!password || password.length < 6){


return res.status(400).json({

success:false,
message:"Password must be minimum 6 characters"

});


}



await client.query("BEGIN");



// Check existing email

const exist = await client.query(

`SELECT id 
 FROM users 
 WHERE email=$1`,

[email.toLowerCase()]

);



if(exist.rows.length){


await client.query("ROLLBACK");


return res.status(400).json({

success:false,
message:"Email already exists"

});


}



// Hash password

const hashedPassword =
await bcrypt.hash(password,10);




// Create Client

const clientResult = await client.query(

`
INSERT INTO clients
(
company_id,
name,
email,
phone,
company_name,
address,
notes,
created_at
)

VALUES($1,$2,$3,$4,$5,$6,$7,NOW())

RETURNING *
`,

[

req.company.id,
name.trim(),
email.toLowerCase(),
phone || null,
clientCompany || null,
address || null,
notes || null

]

);



const newClient =
clientResult.rows[0];




// Create Client Login

const userResult = await client.query(

`
INSERT INTO users
(
name,
email,
password,
role,
company_id,
client_id,
status,
created_at
)

VALUES
($1,$2,$3,'client',$4,$5,'active',NOW())

RETURNING id,name,email,role
`,

[

name,
email.toLowerCase(),
hashedPassword,
req.company.id,
newClient.id

]

);




// Link user with client


await client.query(

`
UPDATE clients
SET user_id=$1
WHERE id=$2
`,

[
userResult.rows[0].id,
newClient.id
]

);



await client.query("COMMIT");



res.status(201).json({

success:true,

message:"Client created successfully",

data:{

client:{

id:newClient.id,
name:newClient.name,
email:newClient.email

},


login:{

email:userResult.rows[0].email,
password:password

}

}


});



}catch(error){


await client.query("ROLLBACK");

next(error);


}finally{


client.release();


}


});




// =================================================
// GET ALL CLIENTS
// =================================================


router.get('/',async(req,res,next)=>{


try{


const result = await pool.query(

`
SELECT 
c.id,
c.name,
c.email,
c.phone,
c.company_name,
c.created_at,
u.id AS user_id

FROM clients c

LEFT JOIN users u
ON u.client_id=c.id

WHERE c.company_id=$1

ORDER BY c.created_at DESC
`,

[req.company.id]

);



res.json({

success:true,
data:result.rows

});



}catch(error){

next(error);

}


});




// =================================================
// GET SINGLE CLIENT
// =================================================


router.get('/:clientId',async(req,res,next)=>{


try{


const client = await pool.query(

`
SELECT *
FROM clients
WHERE id=$1
AND company_id=$2
`,

[
req.params.clientId,
req.company.id
]

);



if(!client.rows[0]){


return res.status(404).json({

success:false,
message:"Client not found"

});


}



res.json({

success:true,
data:client.rows[0]

});


}catch(error){

next(error);

}


});





// =================================================
// DELETE CLIENT
// =================================================


router.delete('/:clientId',
authorizeRole('company','super_admin'),

async(req,res,next)=>{


try{


const result = await pool.query(

`
DELETE FROM clients

WHERE id=$1
AND company_id=$2

RETURNING id

`,

[
req.params.clientId,
req.company.id
]

);



if(!result.rows[0]){


return res.status(404).json({

success:false,
message:"Client not found"

});


}



res.json({

success:true,
message:"Client deleted"

});


}catch(error){

next(error);

}


});



module.exports = router;