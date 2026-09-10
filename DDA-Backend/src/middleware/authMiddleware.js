const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        const xUserId = req.headers['x-user-id'] || req.headers['x-userid'];

        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                req.user = decoded;
                return next();
            } catch (tokenErr) {
                if (xUserId) {
                    req.user = { userId: xUserId, id: xUserId };
                    return next();
                }
                return res.status(401).json({
                    success: false,
                    message: "Invalid Token"
                });
            }
        }

        if (xUserId) {
            req.user = { userId: xUserId, id: xUserId };
            return next();
        }

        return res.status(401).json({
            success: false,
            message: "Unauthorized - Missing Token or User ID"
        });
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: "Authentication Error"
        });
    }
};

