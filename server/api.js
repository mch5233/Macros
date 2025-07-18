require('express');
require('mongodb');

// USDA Food API search function
async function searchUSDAFood(query) {
  const apiKey = process.env.USDA_API_KEY || "DEMO_KEY";
  console.log('Searching USDA API for:', query);
  console.log('Using API key:', apiKey ? 'API key loaded' : 'No API key');
  
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=25`;
    console.log('USDA API URL:', url);
    
    const response = await fetch(url);
    console.log('USDA API response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`USDA API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('USDA API response received, foods count:', data.foods ? data.foods.length : 0);
    
    return data.foods || [];
  } catch (error) {
    console.error('Error searching USDA API:', error);
    throw error;
  }
}

exports.setApp = function ( app, client )
{
    const User = require("./models/user.js");
    const Card = require("./models/card.js");

    app.post('/api/register', async (req, res, next) =>
    {
        // incoming: userLogin, userPassword, userEmail, userFirstName, userLastName
        // outgoing: error

        const { userFirstName, userLastName, userEmail, userLogin, userPassword } = req.body;
        var error = '';
        
        const results = await User.find({ $or: [{login: userLogin}, {email: userEmail}] });
        try
        {
            if ( results.length > 0 )
            {
                error = "Account Already Exists";
            }
            else
            {
                const newUser = new User({ email: userEmail, 
                    login: userLogin, password: userPassword,
                    firstName: userFirstName, lastName: userLastName });
                newUser.save();
            }
        }
        catch(e)
        {
            error = e.toString();
        }

        var ret = { error: error };
        res.status(200).json(ret);
    });

// Add meal route
app.post('/api/addmeal', async (req, res) => {
    console.log('=== ADD MEAL ROUTE CALLED ===');
    console.log('Full request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { userId, mealName, mealType, foodItems, date } = req.body;
        
        console.log('Parsed fields:', { userId, mealName, mealType, foodItems, date });
        
        // Validation
        if (!userId || !mealName || !foodItems || foodItems.length === 0) {
            console.log('ADD MEAL ERROR: Missing required fields');
            return res.status(400).json({ 
                error: 'userId, mealName, and foodItems are required',
                received: { userId, mealName, foodItems }
            });
        }

        const db = client.db('COP4331Cards');
        const meals = db.collection("Meals");
        console.log('Database collection accessed successfully');
        
        // Calculate total nutrition for the meal
        let totalNutrients = {
            calories: 0,
            protein: 0,
            carbohydrates: 0,
            fat: 0,
            fiber: 0,
            sugar: 0,
            sodium: 0
        };
        
        foodItems.forEach(item => {
            if (item.nutrients) {
                totalNutrients.calories += parseFloat(item.nutrients.calories) || 0;
                totalNutrients.protein += parseFloat(item.nutrients.protein) || 0;
                totalNutrients.carbohydrates += parseFloat(item.nutrients.carbohydrates) || 0;
                totalNutrients.fat += parseFloat(item.nutrients.fat) || 0;
                totalNutrients.fiber += parseFloat(item.nutrients.fiber) || 0;
                totalNutrients.sugar += parseFloat(item.nutrients.sugar) || 0;
                totalNutrients.sodium += parseFloat(item.nutrients.sodium) || 0;
            }
        });
        
        // Round to 1 decimal place
        Object.keys(totalNutrients).forEach(key => {
            totalNutrients[key] = totalNutrients[key].toFixed(1);
        });
        
        const newMeal = {
            userId: parseInt(userId),
            mealName: mealName,
            mealType: mealType || 'custom', // breakfast, lunch, dinner, snack, custom
            foodItems: foodItems,
            totalNutrients: totalNutrients,
            dateCreated: date || new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString()
        };
        
        console.log('New meal to insert:', JSON.stringify(newMeal, null, 2));
        
        const result = await meals.insertOne(newMeal);
        console.log('Meal added successfully:', result.insertedId);
        
        res.json({
            success: true,
            message: 'Meal has been created successfully',
            mealId: result.insertedId,
            meal: newMeal
        });
        
    } catch (error) {
        console.error('ADD MEAL ERROR:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to add meal',
            details: error.message
        });
    }
});

// Get user's meals route
app.post('/api/getmeals', async (req, res) => {
    console.log('=== GET MEALS ROUTE CALLED ===');
    const { userId, date } = req.body;
    
    console.log('Get meals request:', { userId, date });
    
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const db = client.db('COP4331Cards');
        const meals = db.collection("Meals");
        const query = { userId: parseInt(userId) };
        
        // If date is provided, filter by date
        if (date) {
            query.dateCreated = date;
        }
        
        const userMeals = await meals.find(query).toArray();
        console.log('Found', userMeals.length, 'meals for user', userId, 'on date', date);
        
        res.json({
            success: true,
            meals: userMeals
        });
    } catch (error) {
        console.error('Get meals error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add meal to daily log (use existing meal as template)
app.post('/api/addmealtoday', async (req, res) => {
    console.log('=== ADD MEAL TO TODAY ROUTE CALLED ===');
    const { userId, mealId, date } = req.body;
    
    console.log('Add meal to today request:', { userId, mealId, date });
    
    if (!userId || !mealId) {
        return res.status(400).json({ error: 'User ID and Meal ID are required' });
    }

    try {
        const db = client.db('COP4331Cards');
        const meals = db.collection("Meals");
        const foodEntries = db.collection("FoodEntries");
        const { ObjectId } = require('mongodb');
        
        // Get the meal
        const meal = await meals.findOne({ 
            _id: new ObjectId(mealId),
            userId: parseInt(userId)
        });
        
        if (!meal) {
            return res.status(404).json({ error: 'Meal not found' });
        }
        
        // Add each food item from the meal to today's food entries
        const today = date || new Date().toISOString().split('T')[0];
        const addedEntries = [];
        
        for (const foodItem of meal.foodItems) {
            const newFoodEntry = {
                userId: parseInt(userId),
                fdcId: foodItem.fdcId,
                foodName: foodItem.foodName,
                brandOwner: foodItem.brandOwner || '',
                servingSize: foodItem.servingSize,
                servingSizeUnit: foodItem.servingSizeUnit || 'g',
                nutrients: foodItem.nutrients,
                dateAdded: today,
                timestamp: new Date().toISOString(),
                mealName: meal.mealName // Track which meal this came from
            };
            
            const result = await foodEntries.insertOne(newFoodEntry);
            addedEntries.push({...newFoodEntry, _id: result.insertedId});
        }
        
        console.log('Added', addedEntries.length, 'food entries from meal', meal.mealName);
        
        res.json({
            success: true,
            message: `Added ${meal.mealName} to today's log`,
            addedEntries: addedEntries
        });
        
    } catch (error) {
        console.error('Add meal to today error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete meal route
app.post('/api/deletemeal', async (req, res) => {
    console.log('=== DELETE MEAL ROUTE CALLED ===');
    const { userId, mealId } = req.body;
    
    console.log('Delete meal request:', { userId, mealId });
    
    if (!mealId) {
        return res.status(400).json({ error: 'Meal ID is required' });
    }

    try {
        const db = client.db('COP4331Cards');
        const { ObjectId } = require('mongodb');
        const meals = db.collection("Meals");
        const result = await meals.deleteOne({ 
            _id: new ObjectId(mealId),
            userId: parseInt(userId) // Also check userId for security
        });
        
        if (result.deletedCount === 1) {
            console.log('Meal deleted successfully:', mealId);
            res.json({
                success: true,
                message: 'Meal deleted'
            });
        } else {
            res.status(404).json({ error: 'Meal not found' });
        }
    } catch (error) {
        console.error('Delete meal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
  
    app.post('/api/login', async (req, res, next) =>
    {
        // incoming: userLogin, userPassword
        // outgoing: id, firstName, lastName, error

        var error = '';

        const { userLogin, userPassword } = req.body;

        //const db = client.db('COP4331Cards');

        const results = await User.find({login: userLogin, password: userPassword});

        var userId = -1;
        var userFirstName = '';
        var userLastName = '';

        var ret;

        if( results.length > 0 )
        {
            userId = results[0]._id;
            userFirstName = results[0].firstName;
            userLastName = results[0].lastName;

            try
            {
                const token = require("./createJWT.js");
                ret = token.createToken( userFirstName, userLastName, userId );
            }
            catch(e)
            {
                ret = {error:e.message};
            }
        }
        else
        {
            ret = {error:"Login/Password incorrect"};
        }
        
        res.status(200).json(ret);
    });

    app.post('/api/updateaccount', async (req, res, next) =>
    {
        // incoming: userId, userFirstName, userLastName, userEmail, userLogin, userJwt
        // outgoing: error

        var token = require('./createJWT.js');
        
        const { userId, userFirstName, userLastName, userEmail, userLogin, userJwt } = req.body;
        
        try
        {
            if(token.isExpired(userJwt))
            {
                var ret = {error: 'The JWT is no longer valid', userJwt: ''};
                res.status(200).json(ret);
                return;
            }
        }
        catch(e)
        {
            console.log(e.message);
        }
        
        var error = '';

        try
        {
            result = await User.updateOne(
                {_id:ObjectId.createFromHexString(userId)},
                {
                    $set: {email: userEmail, login: userLogin,
                        firstName: userFirstName, lastName: userLastName}
                }
            );
            
        }
        catch(e)
        {
            error = e.toString();
        }
        
        var refreshedToken = null;
        try
        {
            refreshedToken = token.refresh(userJwt);
        }
        catch(e)
        {
            console.log(e.message);
        }

        var ret = { error: error, userJwt: refreshedToken };

        res.status(200).json(ret);
    });

    app.post('/api/addcard', async (req, res, next) =>
    {
        // incoming: userId, card, userJwt
        // outgoing: error
        
        var token = require('./createJWT.js');

        const { userId, card, userJwt } = req.body;

        try
        {
            if(token.isExpired(userJwt))
            {
                var ret = {error:'The JWT is no longer valid', userJwt: ''};
                res.status(200).json(ret);
                return;
            }
        }
        catch(e)
        {
            console.log(e.message);
        }

        const newCard = new Card({user:userId, name:card});
        var error = '';

        try
        {
            newCard.save();
        }
        catch(e)
        {
            error = e.toString();
        }
        
        var refreshedToken = null;
        try
        {
            refreshedToken = token.refresh(userJwt);
        }
        catch(e)
        {
            console.log(e.message);
        }

        var ret = { error: error, userJwt: refreshedToken };

        res.status(200).json(ret);
    });

    app.post('/api/searchcards', async (req, res, next) =>
    {
        // incoming: userId, search, userJwt
        // outgoing: results[], error
        
        var error = '';

        var token = require('./createJWT.js');

        const { userId, search, userJwt } = req.body;
        try
        {
            if(token.isExpired(userJwt))
            {
                var ret = {error:'The JWT is no longer valid', userJwt:''};
                res.status(200).json(ret);
                return;
            }
        }
        catch(e)
        {
            console.log(e.message);
        }

        var _search = search.trim();

        const results = await Card.find({ "name": {$regex: _search+'.*', $options: 'i'} })
        
        var _ret = [];
        for( var i = 0; i < results.length; i++ )
        {
            _ret.push( results[i].name );
        }
        
        var refreshedToken = null;
        try
        {
            refreshedToken = token.refresh(userJwt);
        }
        catch(error)
        {
            console.log(error.message);
        }
        
        var ret = { results: _ret, error: error, userJwt: refreshedToken };

        res.status(200).json(ret);
    });

        // Search foods route
    app.post('/api/searchfoods', async (req, res) => {
        console.log('=== SEARCH FOODS ROUTE CALLED ===');
        const { query } = req.body;
        
        console.log('Food search request:', { query });
        
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        try {
            const foods = await searchUSDAFood(query);
            console.log('Returning', foods.length, 'foods');
            res.json({
                success: true,
                foods: foods
            });
        } catch (error) {
            console.error('Error searching USDA API:', error);
            res.status(500).json({ 
                error: 'Failed to search foods',
                details: error.message 
            });
        }
    });

    // Add food route
    app.post('/api/addfood', async (req, res) => {
        console.log('=== ADD FOOD ROUTE CALLED ===');
        console.log('Full request body:', JSON.stringify(req.body, null, 2));
        
        try {
            const { userId, fdcId, servingSize, date } = req.body;
            
            console.log('Parsed fields:', { userId, fdcId, servingSize, date });
            
            // Validation
            if (!userId || !fdcId || !servingSize) {
                console.log('ADD FOOD ERROR: Missing required fields');
                return res.status(400).json({ 
                    error: 'userId, fdcId, and servingSize are required',
                    received: { userId, fdcId, servingSize }
                });
            }

            // First, get food details from USDA API
            console.log('Fetching food details from USDA API for fdcId:', fdcId);
            const foodDetailsUrl = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${process.env.USDA_API_KEY || 'DEMO_KEY'}`;
            const foodResponse = await fetch(foodDetailsUrl);
            
            if (!foodResponse.ok) {
                throw new Error(`Failed to fetch food details: ${foodResponse.status}`);
            }
            
            const foodData = await foodResponse.json();
            console.log('Food data received:', foodData.description);
            
            // Extract nutrition data
            const nutrients = {};
            if (foodData.foodNutrients) {
                foodData.foodNutrients.forEach(nutrient => {
                    const name = nutrient.nutrient?.name?.toLowerCase();
                    if (name) {
                        if (name.includes('energy') || name.includes('calorie')) {
                            nutrients.calories = ((nutrient.amount || 0) * servingSize / 100).toFixed(1);
                        } else if (name.includes('protein')) {
                            nutrients.protein = ((nutrient.amount || 0) * servingSize / 100).toFixed(1);
                        } else if (name.includes('carbohydrate')) {
                            nutrients.carbohydrates = ((nutrient.amount || 0) * servingSize / 100).toFixed(1);
                        } else if (name.includes('fat') && !name.includes('fatty')) {
                            nutrients.fat = ((nutrient.amount || 0) * servingSize / 100).toFixed(1);
                        } else if (name.includes('fiber')) {
                            nutrients.fiber = ((nutrient.amount || 0) * servingSize / 100).toFixed(1);
                        } else if (name.includes('sugar')) {
                            nutrients.sugar = ((nutrient.amount || 0) * servingSize / 100).toFixed(1);
                        } else if (name.includes('sodium')) {
                            nutrients.sodium = ((nutrient.amount || 0) * servingSize / 100).toFixed(1);
                        }
                    }
                });
            }

            const db = client.db('COP4331Cards');
            const foodEntries = db.collection("FoodEntries");
            console.log('Database collection accessed successfully');
            
            const newFoodEntry = {
                userId: parseInt(userId),
                fdcId: parseInt(fdcId),
                foodName: foodData.description || 'Unknown Food',
                brandOwner: foodData.brandOwner || '',
                servingSize: parseFloat(servingSize),
                servingSizeUnit: 'g',
                nutrients: {
                    calories: nutrients.calories || '0',
                    protein: nutrients.protein || '0', 
                    carbohydrates: nutrients.carbohydrates || '0',
                    fat: nutrients.fat || '0',
                    fiber: nutrients.fiber || '0',
                    sugar: nutrients.sugar || '0',
                    sodium: nutrients.sodium || '0'
                },
                dateAdded: date || new Date().toISOString().split('T')[0],
                timestamp: new Date().toISOString()
            };
            
            console.log('New food entry to insert:', JSON.stringify(newFoodEntry, null, 2));
            
            const result = await foodEntries.insertOne(newFoodEntry);
            console.log('Food entry added successfully:', result.insertedId);
            
            res.json({
                success: true,
                message: 'Food has been added to your diary',
                entryId: result.insertedId,
                entry: newFoodEntry
            });
            
        } catch (error) {
            console.error('ADD FOOD ERROR:', error);
            console.error('Error stack:', error.stack);
            res.status(500).json({ 
                error: 'Failed to add food entry',
                details: error.message
            });
        }
    });

    // Get food entries route
    app.post('/api/getfoodentries', async (req, res) => {
        console.log('=== GET FOOD ENTRIES ROUTE CALLED ===');
        const { userId, date } = req.body;
        
        console.log('Get food entries request:', { userId, date });
        
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        try {
            const db = client.db('COP4331Cards');
            const foodEntries = db.collection("FoodEntries");
            const query = { userId: parseInt(userId) };
            
            // If date is provided, filter by date
            if (date) {
                query.dateAdded = date;
            }
            
            const entries = await foodEntries.find(query).toArray();
            console.log('Found', entries.length, 'food entries for user', userId, 'on date', date);
            
            // Calculate total calories
            let totalCalories = 0;
            entries.forEach(entry => {
                if (entry.nutrients && entry.nutrients.calories) {
                    totalCalories += parseFloat(entry.nutrients.calories) || 0;
                }
            });
            
            res.json({
                success: true,
                foodEntries: entries,
                totalCalories: totalCalories.toFixed(1)
            });
        } catch (error) {
            console.error('Get food entries error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Delete food entry route
    app.post('/api/deletefoodentry', async (req, res) => {
        console.log('=== DELETE FOOD ENTRY ROUTE CALLED ===');
        const { userId, entryId } = req.body;
        
        console.log('Delete food entry request:', { userId, entryId });
        
        if (!entryId) {
            return res.status(400).json({ error: 'Entry ID is required' });
        }

        try {
            const db = client.db('COP4331Cards');
            const { ObjectId } = require('mongodb');
            const foodEntries = db.collection("FoodEntries");
            const result = await foodEntries.deleteOne({ 
                _id: new ObjectId(entryId),
                userId: parseInt(userId) // Also check userId for security
            });
            
            if (result.deletedCount === 1) {
                console.log('Food entry deleted successfully:', entryId);
                res.json({
                    success: true,
                    message: 'Food entry deleted'
                });
            } else {
                res.status(404).json({ error: 'Food entry not found' });
            }
        } catch (error) {
            console.error('Delete food entry error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    
    // Test route for USDA API
    app.get('/api/test-usda', async (req, res) => {
        try {
            console.log('Testing USDA API...');
            const foods = await searchUSDAFood('apple');
            res.json({ 
                success: true, 
                count: foods.length, 
                foods: foods.slice(0, 3),
                message: 'USDA API is working!'
            });
        } catch (error) {
            console.error('USDA API test failed:', error);
            res.json({ 
                success: false, 
                error: error.message,
                message: 'USDA API test failed'
            });
        }
    });
}
